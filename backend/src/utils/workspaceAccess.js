import Workspace from "../models/Workspace.js";

export const normalizeWorkspaceId = (rawId) => {
  if (!rawId || typeof rawId !== "string") {
    return null;
  }

  const trimmed = rawId.trim();
  return trimmed || null;
};

export const toIdString = (value) => (value === null || value === undefined ? "" : value.toString());

export const getWorkspaceMembership = (workspace, userId) => {
  if (!workspace || !userId) {
    return null;
  }

  const userIdText = toIdString(userId);
  const members = Array.isArray(workspace.members) ? workspace.members : [];
  const explicitMember = members.find((member) => toIdString(member.user) === userIdText) || null;
  if (explicitMember) {
    return explicitMember;
  }

  if (toIdString(workspace.user) === userIdText) {
    return {
      user: workspace.user,
      role: "owner",
      joinedAt: workspace.createdAt || new Date(),
    };
  }

  return null;
};

export const getWorkspaceOwnerId = (workspace) => {
  if (!workspace) {
    return "";
  }

  const ownerMember = (workspace.members || []).find((member) => member.role === "owner");
  return toIdString(ownerMember?.user || workspace.user);
};

export const hasWorkspaceAccess = (workspace, userId) => Boolean(getWorkspaceMembership(workspace, userId));

export const getWorkspacePermissions = (workspace, userId) => {
  const membership = getWorkspaceMembership(workspace, userId);
  const role = membership?.role || null;
  const isOwner = role === "owner";
  const isMember = role === "member";
  const canAccess = Boolean(membership);
  const canInvite = canAccess && !workspace?.isDefault;

  return {
    role,
    isOwner,
    isMember,
    canAccess,
    canInvite,
    canViewMembers: canAccess,
    canCrudTasks: canAccess,
    canRemoveMembers: isOwner,
    canApproveMembers: isOwner,
    canDeleteWorkspace: isOwner && !workspace?.isDefault,
  };
};

export const findWorkspaceForUser = async (workspaceId, userId) => {
  if (!workspaceId) {
    return null;
  }

  const workspace = await Workspace.findById(workspaceId);
  if (!workspace) {
    return null;
  }

  if (!hasWorkspaceAccess(workspace, userId)) {
    return null;
  }

  return workspace;
};
