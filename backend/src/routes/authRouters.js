import express from "express";
import { login, me, register, resendVerificationEmail, verifyEmail } from "../controllers/authControllers.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
	loginLimiter,
	resendVerificationLimiter,
	verifyEmailLimiter,
} from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", loginLimiter, login);
router.get("/verify-email", verifyEmailLimiter, verifyEmail);
router.post("/resend-verification", resendVerificationLimiter, resendVerificationEmail);
router.get("/me", requireAuth, me);

export default router;
