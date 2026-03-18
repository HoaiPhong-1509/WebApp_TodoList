import express from "express";
import { changePassword, login, me, register, resendVerificationEmail, verifyEmail } from "../controllers/authControllers.js";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
	loginLimiter,
	registerEmailLimiter,
	registerIpLimiter,
	resendVerificationLimiter,
	verifyEmailLimiter,
} from "../middleware/rateLimitMiddleware.js";

const router = express.Router();

router.post("/register", registerIpLimiter, registerEmailLimiter, register);
router.post("/login", loginLimiter, login);
router.get("/verify-email", verifyEmailLimiter, verifyEmail);
router.post("/resend-verification", resendVerificationLimiter, resendVerificationEmail);
router.get("/me", requireAuth, me);
router.post("/change-password", requireAuth, loginLimiter, changePassword);

export default router;
