import User from "../models/User.js";
import { createAuthToken, hashPassword, verifyPassword } from "../utils/auth.js";
import { hasMxRecords, isValidEmailFormat } from "../utils/emailValidation.js";
import crypto from "crypto";
import { sendVerificationEmail } from "../services/emailService.js";

const VERIFICATION_TOKEN_TTL_MS = 60 * 60 * 1000;

const getAuthSecret = () => process.env.JWT_SECRET || "dev_secret_change_me";

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

    const emailHasMx = await hasMxRecords(normalizedEmail);
    if (!emailHasMx) {
      return res.status(400).json({ message: "Email domain cannot receive mail" });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(409).json({ message: "Email is already in use" });
    }

    const verification = createVerificationTokenPair();

    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      password: hashPassword(password),
      isVerified: false,
      verificationToken: verification.hashedToken,
      verificationTokenExpiresAt: verification.expiresAt,
    });

    let emailResult;
    try {
      emailResult = await sendVerificationEmail({
        email: user.email,
        name: user.name,
        token: verification.rawToken,
      });

      console.info("[auth][register] verification email sent", {
        to: user.email,
        isMockMailTransport: emailResult.isMock,
        accepted: emailResult.info?.accepted,
        rejected: emailResult.info?.rejected,
        response: emailResult.info?.response,
        messageId: emailResult.info?.messageId,
      });
    } catch (error) {
      console.error("Error sending verification email:", error);

      return res.status(201).json({
        message:
          "Registration successful, but we could not send the verification email right now. Please use Resend Verification on the login screen.",
        emailDeliveryFailed: true,
      });
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
    },
  });
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

    const emailResult = await sendVerificationEmail({
      email: user.email,
      name: user.name,
      token: verification.rawToken,
    });

    console.info("[auth][resend] verification email sent", {
      to: user.email,
      isMockMailTransport: emailResult.isMock,
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
