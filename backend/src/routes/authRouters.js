import express from "express";
import { login, me, register, verifyEmail } from "../controllers/authControllers.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.get("/verify-email", verifyEmail);
router.get("/me", requireAuth, me);

export default router;
