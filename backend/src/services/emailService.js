import nodemailer from "nodemailer";

const toBoolean = (value) => String(value).toLowerCase() === "true";

const buildTransport = () => {
  const {
    MAIL_HOST,
    MAIL_PORT,
    MAIL_USER,
    MAIL_PASS,
    MAIL_SECURE,
    NODE_ENV,
  } = process.env;

  const hasSmtpConfig = Boolean(MAIL_HOST && MAIL_PORT && MAIL_USER && MAIL_PASS);

  if (hasSmtpConfig) {
    return nodemailer.createTransport({
      host: MAIL_HOST,
      port: Number(MAIL_PORT),
      secure: toBoolean(MAIL_SECURE),
      auth: {
        user: MAIL_USER,
        pass: MAIL_PASS,
      },
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

  const appUrl = APP_BASE_URL || "http://localhost:5173";
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
