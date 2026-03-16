import nodemailer from "nodemailer";
import dns from "dns";

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

const normalizeMailPassword = (value) => {
  if (typeof value !== "string") {
    return value;
  }

  // Gmail app passwords are often copied with spaces every 4 chars.
  return value.replace(/\s+/g, "");
};

const DEFAULT_MAIL_TIMEOUT_MS = 8_000;
const MAX_MAIL_TIMEOUT_MS = 12_000;

const getMailTimeoutMs = () => {
  const parsed = toNumber(process.env.MAIL_TIMEOUT_MS, DEFAULT_MAIL_TIMEOUT_MS);

  if (parsed <= 0) {
    return DEFAULT_MAIL_TIMEOUT_MS;
  }

  return Math.min(Math.max(parsed, 1_000), MAX_MAIL_TIMEOUT_MS);
};

const buildTransport = () => {
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
    const timeoutMs = getMailTimeoutMs();
    return nodemailer.createTransport({
      host: MAIL_HOST,
      port: Number(MAIL_PORT),
      secure: toBoolean(MAIL_SECURE),
      auth: {
        user: MAIL_USER,
        pass: normalizedMailPass,
      },
      connectionTimeout: timeoutMs,
      greetingTimeout: timeoutMs,
      socketTimeout: timeoutMs,
    });
  }

  if (NODE_ENV === "production") {
    throw new Error("SMTP configuration is required in production (MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASS)");
  }


  return nodemailer.createTransport({ jsonTransport: true });
};

export const sendVerificationEmail = async ({ email, name, token }) => {
  const { APP_BASE_URL, MAIL_FROM, MAIL_USER } = process.env;
  const transporter = buildTransport();
  const isMock = !!transporter.options?.jsonTransport;

  const appUrl = (APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
  const verifyUrl = `${appUrl}/verify-email?token=${token}`;

  const info = await transporter.sendMail({
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
    isMock,
  };
};
