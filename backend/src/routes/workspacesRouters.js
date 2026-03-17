import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import {
  activateWorkspace,
  createWorkspace,
  listWorkspaces,
} from "../controllers/workspacesControllers.js";

const router = express.Router();

router.use(requireAuth);

router.get("/", listWorkspaces);
router.post("/", createWorkspace);
router.patch("/:id/activate", activateWorkspace);

export default router;
