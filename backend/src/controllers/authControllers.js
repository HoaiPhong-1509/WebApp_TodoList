import User from "../models/User.js";
import { createAuthToken, hashPassword, verifyPassword } from "../utils/auth.js";
import { isValidEmailFormat, validateEmailDeliverability } from "../utils/emailValidation.js";
import crypto from "crypto";
import { sendVerificationEmail } from "../services/emailService.js";
import { ensureDefaultWorkspace } from "./workspacesControllers.js";

const VERIFICATION_TOKEN_TTL_MS = 60 * 60 * 1000;
const PASSWORD_CHANGE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
const EMAIL_CONTROLLER_OVERHEAD_MS = 3_000;
const FRONTEND_AXIOS_TIMEOUT_MS = 60_000;
const MAX_EMAIL_CONTROLLER_TIMEOUT_MS = 55_000;

// Total wall-clock budget for one email-send attempt.
// Reads MAIL_SEND_TIMEOUT_MS (also used by emailService) and keeps the API response
// below the frontend 60 s timeout.
// The cap stays below the 60 s frontend axios timeout.
const getEmailControllerTimeoutMs = () => {
  const val = process.env.MAIL_SEND_TIMEOUT_MS || process.env.MAIL_TIMEOUT_MS;
  const parsed = Number(val);
  const providerTimeoutMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
  return Math.min(providerTimeoutMs + EMAIL_CONTROLLER_OVERHEAD_MS, Math.min(FRONTEND_AXIOS_TIMEOUT_MS - 1_000, MAX_EMAIL_CONTROLLER_TIMEOUT_MS));
};

// Wraps an email-send promise with a hard wall-clock timeout so the HTTP request
// always returns quickly even if the email provider is unresponsive.
const sendEmailWithTimeout = (sendFn) => {
  const timeoutMs = getEmailControllerTimeoutMs();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        Object.assign(
          new Error(`Email send timed out after ${timeoutMs}ms`),
          { code: "EMAIL_CONTROLLER_TIMEOUT" }
        )
      );
    }, timeoutMs);
    // Use Promise.resolve to guard against sendFn throwing synchronously.
    Promise.resolve().then(() => sendFn()).then(
      (result) => { clearTimeout(timer); resolve(result); },
      (err)    => { clearTimeout(timer); reject(err); }
    );
  });
};

const getAuthSecret = () => process.env.JWT_SECRET || "dev_secret_change_me";
const isProduction = () => process.env.NODE_ENV === "production";

const buildAppBaseUrl = () => {
  const base = process.env.APP_BASE_URL || "http://localhost:5173";
  return String(base).replace(/\/+$/, "");
};

const buildVerifyEmailUrl = (rawToken) => {
  const appUrl = buildAppBaseUrl();
  return `${appUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
};

const shouldReturnVerificationUrl = () => {
  // Never expose direct verification links in production responses.
  if (isProduction()) {
    return false;
  }

  const flag = process.env.RETURN_VERIFICATION_URL;

  if (flag === undefined || String(flag).trim() === "") {
    // Dev-only convenience fallback.
    return true;
  }

  return String(flag).toLowerCase() === "true";
};


const createVerificationTokenPair = () => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

  return {
    rawToken,
    hashedToken,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  };
};

const toAuthResponse = (user) => {
  const token = createAuthToken(
    {
      userId: user._id.toString(),
      email: user.email,
    },
    getAuthSecret()
  );

  return {
    token,
    user: {
      id: user._id,
      name: user.name,
      email: user.email,
      isVerified: user.isVerified,
      createdAt: user.createdAt,
      lastPasswordChangedAt: user.lastPasswordChangedAt || null,
    },
  };
};

export const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const emailValidation = await validateEmailDeliverability(normalizedEmail);
    if (!emailValidation.ok) {
      const message = emailValidation.reason === "invalid_domain"
        ? "Email domain does not exist or cannot receive mail"
        : emailValidation.reason === "disposable_domain"
          ? "Disposable email addresses are not allowed"
          : "Email address appears invalid or cannot receive mail";
      return res.status(400).json({ message });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "Email is already in use" });
    }

    const verification = createVerificationTokenPair();

    const dbStart = Date.now();
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashPassword(password),
      isVerified: false,
      verificationToken: verification.hashedToken,
      verificationTokenExpiresAt: verification.expiresAt,
    });

    await ensureDefaultWorkspace(user._id);
    console.info("[auth][register] user created in DB", { ms: Date.now() - dbStart, userId: user._id });

    let emailResult;
    const emailStart = Date.now();
    try {
      emailResult = await sendEmailWithTimeout(() =>
        sendVerificationEmail({
          email: user.email,
          name: user.name,
          token: verification.rawToken,
        })
      );

      console.info("[auth][register] verification email sent", {
        ms: Date.now() - emailStart,
        to: user.email,
        isMockMailTransport: emailResult.isMock,
        provider: emailResult.provider,
        accepted: emailResult.info?.accepted,
        rejected: emailResult.info?.rejected,
        response: emailResult.info?.response,
        messageId: emailResult.info?.messageId,
      });
    } catch (error) {
      console.error("[auth][register] email send failed", { ms: Date.now() - emailStart, code: error.code, message: error.message });

      const response = {
        message:
          "Registration successful, but we could not send the verification email right now. Please use Resend Verification Email on the login screen to try again.",
        emailDeliveryFailed: true,
      };

      if (shouldReturnVerificationUrl()) {
        response.verificationUrl = buildVerifyEmailUrl(verification.rawToken);
      }

      return res.status(201).json(response);
    }

    const response = {
      message: "Registration successful. Please verify your email before logging in.",
    };

    if (process.env.NODE_ENV !== "production" && emailResult.isMock) {
      response.verificationUrl = emailResult.verifyUrl;
    }

    return res.status(201).json(response);
  } catch (error) {
    console.error("Error registering user:", error);
    return res.status(500).json({ message: "Server error while registering user" });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.isVerified) {
      return res.status(403).json({ message: "Please verify your email before logging in" });
    }

    return res.status(200).json(toAuthResponse(user));
  } catch (error) {
    console.error("Error logging in:", error);
    return res.status(500).json({ message: "Server error while logging in" });
  }
};

export const me = async (req, res) => {
  return res.status(200).json({
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      isVerified: req.user.isVerified,
      createdAt: req.user.createdAt,
      lastPasswordChangedAt: req.user.lastPasswordChangedAt || null,
    },
  });
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current password and new password are required" });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ message: "New password must be different from current password" });
    }

    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!verifyPassword(currentPassword, user.password)) {
      return res.status(401).json({ message: "Current password is incorrect" });
    }

    if (user.lastPasswordChangedAt) {
      const nextAllowedAt = new Date(user.lastPasswordChangedAt.getTime() + PASSWORD_CHANGE_COOLDOWN_MS);
      if (nextAllowedAt.getTime() > Date.now()) {
        return res.status(429).json({
          message: "You can only change password once every 3 days",
          nextAllowedAt,
        });
      }
    }

    user.password = hashPassword(newPassword);
    user.lastPasswordChangedAt = new Date();
    await user.save();

    return res.status(200).json({
      message: "Password changed successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isVerified: user.isVerified,
        createdAt: user.createdAt,
        lastPasswordChangedAt: user.lastPasswordChangedAt,
      },
    });
  } catch (error) {
    console.error("Error changing password:", error);
    return res.status(500).json({ message: "Server error while changing password" });
  }
};

export const verifyEmail = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== "string") {
      return res.status(400).json({ message: "Verification token is required" });
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationTokenExpiresAt: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired verification token" });
    }

    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpiresAt = null;
    await user.save();

    return res.status(200).json({ message: "Email verified successfully. You can now log in." });
  } catch (error) {
    console.error("Error verifying email:", error);
    return res.status(500).json({ message: "Server error while verifying email" });
  }
};

export const resendVerificationEmail = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== "string") {
      return res.status(400).json({ message: "Email is required" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!isValidEmailFormat(normalizedEmail)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const emailValidation = await validateEmailDeliverability(normalizedEmail);
    if (!emailValidation.ok) {
      return res.status(400).json({ message: "Email address appears invalid or cannot receive mail" });
    }

    const user = await User.findOne({ email: normalizedEmail });

    if (!user || user.isVerified) {
      return res.status(200).json({
        message: "If this email exists and is not verified, a verification email has been sent.",
      });
    }

    const verification = createVerificationTokenPair();
    user.verificationToken = verification.hashedToken;
    user.verificationTokenExpiresAt = verification.expiresAt;
    await user.save();

    let emailResult;
    const emailStart = Date.now();
    try {
      emailResult = await sendEmailWithTimeout(() =>
        sendVerificationEmail({
          email: user.email,
          name: user.name,
          token: verification.rawToken,
        })
      );
    } catch (error) {
      console.error("[auth][resend] email send failed", { ms: Date.now() - emailStart, code: error.code, message: error.message });

      const response = {
        message:
          "Verification email service is temporarily unavailable. Please try again later.",
      };
      if (shouldReturnVerificationUrl()) {
        response.verificationUrl = buildVerifyEmailUrl(verification.rawToken);
      }

      return res.status(503).json(response);
    }

    console.info("[auth][resend] verification email sent", {
      ms: Date.now() - emailStart,
      to: user.email,
      isMockMailTransport: emailResult.isMock,
      provider: emailResult.provider,
      accepted: emailResult.info?.accepted,
      rejected: emailResult.info?.rejected,
      response: emailResult.info?.response,
      messageId: emailResult.info?.messageId,
    });

    return res.status(200).json({
      message: "If this email exists and is not verified, a verification email has been sent.",
    });
  } catch (error) {
    console.error("Error resending verification email:", error);

    return res.status(503).json({
      message:
        "Verification email service is temporarily unavailable. Please try again later.",
    });
  }
};
