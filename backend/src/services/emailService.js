import nodemailer from "nodemailer";
import dns from "dns";
import net from "net";

// Some hosting environments have problematic IPv6 connectivity.
// Prefer IPv4 to avoid long connection hangs to SMTP providers.
try {
  if (typeof dns.setDefaultResultOrder === "function") {
    dns.setDefaultResultOrder("ipv4first");
  }
} catch {
  // Ignore; not available on all Node versions.
}

const toBoolean = (value) => String(value).toLowerCase() === "true";

const toNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const parseBooleanEnv = (value, fallback) => {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }

  return String(value).toLowerCase() === "true";
};

const normalizeMailPassword = (value) => {
  if (typeof value !== "string") {
    return value;
  }

  // Gmail app passwords are often copied with spaces every 4 chars.
  return value.replace(/\s+/g, "");
};

const isRetryableSmtpError = (error) => {
  if (!error) {
    return false;
  }

  const code = String(error.code || "").toUpperCase();
  if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNRESET", "EHOSTUNREACH", "ENETUNREACH"].includes(code)) {
    return true;
  }

  const message = String(error.message || "").toLowerCase();
  return message.includes("timeout") || message.includes("connection") || message.includes("greeting never received");
};

const shouldRetryWithTls465 = ({ host, port, secure }) => {
  const envFlag = String(process.env.MAIL_ENABLE_FALLBACK_465 ?? "true").toLowerCase() === "true";
  if (!envFlag) {
    return false;
  }

  // Common fallback path for Gmail-style SMTP: 587 STARTTLS -> 465 SMTPS.
  return String(host || "").toLowerCase() === "smtp.gmail.com" && Number(port) === 587 && secure === false;
};

// Lower default in production so each SMTP phase times out before the frontend 60 s axios limit.
const DEFAULT_MAIL_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 10_000 : 8_000;
const MAX_MAIL_TIMEOUT_MS = 60_000;

const getMailTimeoutMs = () => {
  // Support both MAIL_SEND_TIMEOUT_MS (documented in README) and the older MAIL_TIMEOUT_MS alias.
  const envValue = process.env.MAIL_SEND_TIMEOUT_MS || process.env.MAIL_TIMEOUT_MS;
  const parsed = toNumber(envValue, DEFAULT_MAIL_TIMEOUT_MS);

  if (parsed <= 0) {
    return DEFAULT_MAIL_TIMEOUT_MS;
  }

  return Math.min(Math.max(parsed, 1_000), MAX_MAIL_TIMEOUT_MS);
};

const shouldForceIpv4 = () => {
  // Default true in production where many platforms have limited IPv6 egress.
  return parseBooleanEnv(process.env.MAIL_FORCE_IPV4, process.env.NODE_ENV === "production");
};

const resolveConnectHost = async (host) => {
  if (!shouldForceIpv4()) {
    return {
      connectHost: host,
      forcedIpv4: false,
    };
  }

  if (net.isIP(host)) {
    return {
      connectHost: host,
      forcedIpv4: false,
    };
  }

  try {
    const result = await dns.promises.lookup(host, {
      family: 4,
      all: true,
      verbatim: false,
    });

    const first = Array.isArray(result) ? result[0] : result;

    if (first?.address) {
      return {
        connectHost: first.address,
        forcedIpv4: true,
      };
    }
  } catch {
    // Fall back to hostname and let Node decide if explicit lookup fails.
  }

  return {
    connectHost: host,
    forcedIpv4: false,
  };
};

const buildTransport = ({ host, connectHost, port, secure, user, pass, timeoutMs }) => {
  return nodemailer.createTransport({
    host: connectHost || host,
    port: Number(port),
    secure,
    auth: {
      user,
      pass,
    },
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    requireTLS: !secure,
    tls: {
      servername: host,
      minVersion: "TLSv1.2",
    },
  });
};

const getSmtpConfig = () => {
  const {
    MAIL_HOST,
    MAIL_PORT,
    MAIL_USER,
    MAIL_PASS,
    MAIL_SECURE,
    NODE_ENV,
  } = process.env;
  const normalizedMailPass = normalizeMailPassword(MAIL_PASS);

  const hasSmtpConfig = Boolean(MAIL_HOST && MAIL_PORT && MAIL_USER && normalizedMailPass);

  if (hasSmtpConfig) {
    return {
      host: MAIL_HOST,
      port: Number(MAIL_PORT),
      secure: toBoolean(MAIL_SECURE),
      user: MAIL_USER,
      pass: normalizedMailPass,
      timeoutMs: getMailTimeoutMs(),
      isMock: false,
    };
  }

  if (NODE_ENV === "production") {
    throw new Error("SMTP configuration is required in production (MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS)");
  }

  return {
    isMock: true,
  };
};

const sendWithSmtpConfig = async ({ config, mailOptions }) => {
  const resolution = await resolveConnectHost(config.host);
  const transporter = buildTransport({
    ...config,
    connectHost: resolution.connectHost,
  });
  const info = await transporter.sendMail(mailOptions);
  return {
    info,
    usedFallback465: false,
    smtpConnectHost: resolution.connectHost,
    forcedIpv4: resolution.forcedIpv4,
  };
};

export const sendVerificationEmail = async ({ email, name, token }) => {
  const { APP_BASE_URL, MAIL_FROM, MAIL_USER } = process.env;
  const smtpConfig = getSmtpConfig();

  const appUrl = (APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
  const verifyUrl = `${appUrl}/verify-email?token=${token}`;

  if (smtpConfig.isMock) {
    const mockTransporter = nodemailer.createTransport({ jsonTransport: true });
    const info = await mockTransporter.sendMail({
      from: MAIL_FROM || MAIL_USER || "no-reply@todolist.local",
      to: email,
      subject: "Verify your TodoList account",
      text: `Hi ${name},\n\nPlease verify your account by clicking this link:\n${verifyUrl}\n\nThis link will expire in 1 hour.`,
      html: `
      <p>Hi ${name},</p>
      <p>Please verify your account by clicking the link below:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link will expire in 1 hour.</p>
    `,
    });

    return {
      info,
      verifyUrl,
      isMock: true,
      usedFallback465: false,
    };
  }

  const mailOptions = {
    from: MAIL_FROM || MAIL_USER || "no-reply@todolist.local",
    to: email,
    subject: "Verify your TodoList account",
    text: `Hi ${name},\n\nPlease verify your account by clicking this link:\n${verifyUrl}\n\nThis link will expire in 1 hour.`,
    html: `
      <p>Hi ${name},</p>
      <p>Please verify your account by clicking the link below:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link will expire in 1 hour.</p>
    `,
  };

  try {
    const result = await sendWithSmtpConfig({ config: smtpConfig, mailOptions });
    return {
      info: result.info,
      verifyUrl,
      isMock: false,
      usedFallback465: result.usedFallback465,
      smtpConnectHost: result.smtpConnectHost,
      forcedIpv4: result.forcedIpv4,
    };
  } catch (error) {
    if (!isRetryableSmtpError(error) || !shouldRetryWithTls465(smtpConfig)) {
      throw error;
    }

    const fallbackConfig = {
      ...smtpConfig,
      port: 465,
      secure: true,
      // Slightly longer timeout for TLS direct connect retry.
      timeoutMs: Math.min(smtpConfig.timeoutMs + 5_000, MAX_MAIL_TIMEOUT_MS),
    };

    const fallbackResult = await sendWithSmtpConfig({ config: fallbackConfig, mailOptions });
    return {
      info: fallbackResult.info,
      verifyUrl,
      isMock: false,
      usedFallback465: true,
      smtpConnectHost: fallbackResult.smtpConnectHost,
      forcedIpv4: fallbackResult.forcedIpv4,
    };
  }

};
