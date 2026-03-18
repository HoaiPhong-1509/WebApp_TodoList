import WorkspaceActivity from "../models/WorkspaceActivity.js";

const normalizeActorName = (actor) => {
  if (!actor) {
    return "System";
  }

  return actor.name || actor.email || "Unknown user";
};

const normalizeActorEmail = (actor) => {
  if (!actor) {
    return "";
  }

  return actor.email || "";
};

export const logWorkspaceActivity = async ({ workspaceId, actor = null, type, message, metadata = {} }) => {
  if (!workspaceId || !type || !message) {
    return null;
  }

  try {
    return await WorkspaceActivity.create({
      workspace: workspaceId,
      actor: actor?._id || null,
      actorName: normalizeActorName(actor),
      actorEmail: normalizeActorEmail(actor),
      type,
      message,
      metadata,
    });
  } catch (error) {
    console.error("Error logging workspace activity:", error);
    return null;
  }
};
