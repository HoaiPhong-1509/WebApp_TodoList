import { rateLimit } from "express-rate-limit";

const jsonMessage = (message) => ({ message });

const createLimiter = ({ windowMs, max, message }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: jsonMessage(message),
  });

export const loginLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many login attempts. Please try again later.",
});

export const registerIpLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many registration attempts from this IP. Please try again later.",
});

export const registerEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const rawEmail = req?.body?.email;
    if (!rawEmail || typeof rawEmail !== "string") {
      return `ip:${req.ip}`;
    }
    return `register-email:${rawEmail.trim().toLowerCase()}`;
  },
  message: jsonMessage("Too many registration attempts for this email. Please try again later."),
});

export const verifyEmailLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many verification attempts. Please try again later.",
});

export const resendVerificationLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "Too many resend attempts. Please try again later.",
});
