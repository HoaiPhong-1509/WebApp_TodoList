import mongoose from "mongoose";

const workspaceActivitySchema = new mongoose.Schema(
  {
    workspace: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    actorName: {
      type: String,
      default: "System",
      trim: true,
      maxlength: 120,
    },
    actorEmail: {
      type: String,
      default: "",
      trim: true,
      lowercase: true,
      maxlength: 180,
    },
    type: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 64,
      index: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 600,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

workspaceActivitySchema.index({ workspace: 1, createdAt: -1 });

const WorkspaceActivity = mongoose.model("WorkspaceActivity", workspaceActivitySchema);
export default WorkspaceActivity;
