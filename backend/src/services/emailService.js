const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";
const DEFAULT_SEND_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 10_000 : 8_000;
const MAX_SEND_TIMEOUT_MS = 60_000;

const toNumber = (value, fallback) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const getSendTimeoutMs = () => {
  const envValue = process.env.MAIL_SEND_TIMEOUT_MS || process.env.MAIL_TIMEOUT_MS;
  const parsed = toNumber(envValue, DEFAULT_SEND_TIMEOUT_MS);

  if (parsed <= 0) {
    return DEFAULT_SEND_TIMEOUT_MS;
  }

  return Math.min(Math.max(parsed, 1_000), MAX_SEND_TIMEOUT_MS);
};

const getBrevoConfig = () => {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "TodoList";

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    senderEmail,
    senderName,
  };
};

const sendWithBrevo = async ({ brevoConfig, mailOptions }) => {
  if (!brevoConfig?.senderEmail) {
    const err = new Error("BREVO_SENDER_EMAIL is required when BREVO_API_KEY is set");
    err.code = "BREVO_MISSING_SENDER";
    throw err;
  }

  const timeoutMs = getSendTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(BREVO_API_URL, {
      method: "POST",
      headers: {
        "api-key": brevoConfig.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: {
          email: brevoConfig.senderEmail,
          name: brevoConfig.senderName,
        },
        to: [{ email: mailOptions.to }],
        subject: mailOptions.subject,
        textContent: mailOptions.text,
        html: mailOptions.html,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error(`Brevo API timed out after ${timeoutMs}ms`);
      timeoutError.code = "BREVO_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.message || `Brevo API failed with status ${response.status}`;
    const err = new Error(message);
    err.code = "BREVO_SEND_FAILED";
    err.status = response.status;
    throw err;
  }

  return {
    info: {
      accepted: [mailOptions.to],
      rejected: [],
      response: `Brevo status ${response.status}`,
      messageId: payload?.messageId,
      provider: "brevo",
    },
  };
};

export const sendVerificationEmail = async ({ email, name, token }) => {
  const { APP_BASE_URL } = process.env;
  const appUrl = (APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, "");
  const verifyUrl = `${appUrl}/verify-email?token=${token}`;

  const mailOptions = {
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

  const brevoConfig = getBrevoConfig();
  if (brevoConfig) {
    const result = await sendWithBrevo({ brevoConfig, mailOptions });
    return {
      info: result.info,
      verifyUrl,
      isMock: false,
      provider: "brevo",
    };
  }

  if (process.env.NODE_ENV === "production") {
    const err = new Error("BREVO_API_KEY and BREVO_SENDER_EMAIL are required in production for email delivery");
    err.code = "EMAIL_PROVIDER_NOT_CONFIGURED";
    throw err;
  }

  return {
    info: {
      accepted: [mailOptions.to],
      rejected: [],
      response: "Mock mail transport",
      messageId: `mock-${Date.now()}`,
      provider: "mock",
    },
    verifyUrl,
    isMock: true,
    provider: "mock",
  };
};
