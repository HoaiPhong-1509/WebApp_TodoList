import express from "express";
import {
	addConversationMembers,
	chatWithAssistant,
	createDirectConversation,
	deleteConversation,
	createGroupConversation,
	createMessage,
	getConversationMessages,
	getConversations,
	leaveConversation,
	searchUsers,
} from "../controllers/chatControllers.js";
import { requireAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(requireAuth);

router.get("/users", searchUsers);
router.get("/conversations", getConversations);
router.post("/assistant", chatWithAssistant);
router.post("/conversations/direct", createDirectConversation);
router.post("/conversations/group", createGroupConversation);
router.post("/conversations/:id/members", addConversationMembers);
router.post("/conversations/:id/leave", leaveConversation);
router.get("/conversations/:id/messages", getConversationMessages);
router.post("/conversations/:id/messages", createMessage);
router.delete("/conversations/:id", deleteConversation);

export default router;
