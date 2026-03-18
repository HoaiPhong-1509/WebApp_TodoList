import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  activateWorkspace,
  approveWorkspaceMember,
  createWorkspace,
  deleteWorkspace,
  getInviteCode,
  getWorkspaceActivities,
  markAllWorkspaceNotificationsRead,
  getWorkspaceNotificationsSummary,
  getWorkspaceMembers,
  joinWorkspaceByInviteCode,
  listWorkspaces,
  rejectWorkspaceMember,
  removeWorkspaceMember,
} from "../controllers/workspacesControllers.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", listWorkspaces);
router.get("/notifications/summary", getWorkspaceNotificationsSummary);
router.post("/notifications/mark-all-read", markAllWorkspaceNotificationsRead);
router.post("/", createWorkspace);
router.post("/join-by-code", joinWorkspaceByInviteCode);
router.patch("/:id/activate", activateWorkspace);
router.get("/:id/members", getWorkspaceMembers);
router.get("/:id/activities", getWorkspaceActivities);
router.post("/:id/invite-code", getInviteCode);
router.post("/:id/pending/:userId/approve", approveWorkspaceMember);
router.post("/:id/pending/:userId/reject", rejectWorkspaceMember);
router.delete("/:id/members/:memberId", removeWorkspaceMember);
router.delete("/:id", deleteWorkspace);

export default router;
