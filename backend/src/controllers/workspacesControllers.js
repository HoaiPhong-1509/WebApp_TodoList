import Workspace from "../models/Workspace.js";
import User from "../models/User.js";
import Task from "../models/Task.js";
import WorkspaceActivity from "../models/WorkspaceActivity.js";
import {
  findWorkspaceForUser,
  getWorkspaceOwnerId,
  getWorkspacePermissions,
  normalizeWorkspaceId,
  toIdString,
} from "../utils/workspaceAccess.js";
import { logWorkspaceActivity } from "../utils/workspaceActivity.js";

const normalize = (value = "") => String(value).trim().toLowerCase();
const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const generateInviteCodeCandidate = (length = 8) => {
  let output = "";
  for (let idx = 0; idx < length; idx += 1) {
    const randomIndex = Math.floor(Math.random() * INVITE_CODE_ALPHABET.length);
    output += INVITE_CODE_ALPHABET[randomIndex];
  }
  return output;
};

const createUniqueInviteCode = async () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateInviteCodeCandidate(8);
    const existing = await Workspace.exists({ inviteCode: code });
    if (!existing) {
      return code;
    }
  }

  return `${generateInviteCodeCandidate(6)}${Date.now().toString().slice(-2)}`;
};

const scoreWorkspace = (normalizedName, normalizedQuery) => {
  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedName === normalizedQuery) {
    return 1000;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 700;
  }

  const idx = normalizedName.indexOf(normalizedQuery);
  if (idx >= 0) {
    return 500 - idx;
  }

  let overlap = 0;
  for (const ch of normalizedQuery) {
    if (normalizedName.includes(ch)) {
      overlap += 1;
    }
  }

  return overlap;
};

export const ensureDefaultWorkspace = async (userId) => {
  const existing = await Workspace.findOne({ user: userId, isDefault: true });
  if (existing) {
    const ownerId = toIdString(existing.user);
    const hasOwnerMember = (existing.members || []).some(
      (member) => toIdString(member.user) === ownerId
    );

    if (!hasOwnerMember) {
      existing.members = [
        {
          user: existing.user,
          role: "owner",
          joinedAt: existing.createdAt || new Date(),
        },
      ];
      await existing.save();
    }

    return existing;
  }

  try {
    return await Workspace.create({
      user: userId,
      name: "My Workspace",
      normalizedName: "my workspace",
      isDefault: true,
      lastAccessedAt: new Date(),
      members: [
        {
          user: userId,
          role: "owner",
          joinedAt: new Date(),
        },
      ],
    });
  } catch (error) {
    if (error?.code === 11000) {
      return Workspace.findOne({ user: userId, isDefault: true });
    }
    throw error;
  }
};

export const listWorkspaces = async (req, res) => {
  try {
    const userId = req.user._id;
    const q = normalize(req.query.q || "");

    await ensureDefaultWorkspace(userId);

    const workspaces = await Workspace.find({
      $or: [{ user: userId }, { "members.user": userId }],
    })
      .select("_id name isDefault lastAccessedAt updatedAt createdAt members pendingMembers user")
      .lean();

    const ranked = workspaces
      .map((workspace) => ({
        ...workspace,
        relevance: scoreWorkspace(normalize(workspace.name), q),
        permissions: getWorkspacePermissions(workspace, userId),
        memberCount: Array.isArray(workspace.members) && workspace.members.length > 0
          ? workspace.members.length
          : (workspace.user ? 1 : 0),
        pendingCount: getWorkspacePermissions(workspace, userId).canApproveMembers
          ? (Array.isArray(workspace.pendingMembers) ? workspace.pendingMembers.length : 0)
          : 0,
      }))
      .filter((workspace) => (q ? workspace.relevance > 0 : true))
      .sort((a, b) => {
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        return new Date(b.lastAccessedAt || b.updatedAt || b.createdAt) - new Date(a.lastAccessedAt || a.updatedAt || a.createdAt);
      })
      .map(({ relevance, members, pendingMembers, user, ...workspace }) => workspace);

    return res.status(200).json({ workspaces: ranked });
  } catch (error) {
    console.error("Error listing workspaces:", error);
    return res.status(500).json({ message: "Server error while listing workspaces" });
  }
};

export const createWorkspace = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "Workspace name is required" });
    }

    const userId = req.user._id;
    await ensureDefaultWorkspace(userId);

    const workspace = await Workspace.create({
      user: userId,
      name,
      normalizedName: name.toLowerCase(),
      isDefault: false,
      lastAccessedAt: new Date(),
      members: [
        {
          user: userId,
          role: "owner",
          joinedAt: new Date(),
        },
      ],
    });

    await logWorkspaceActivity({
      workspaceId: workspace._id,
      actor: req.user,
      type: "workspace_created",
      message: `${req.user.name || req.user.email} created workspace \"${workspace.name}\"`,
      metadata: {
        workspaceName: workspace.name,
      },
    });

    return res.status(201).json({ workspace });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Workspace name already exists" });
    }

    console.error("Error creating workspace:", error);
    return res.status(500).json({ message: "Server error while creating workspace" });
  }
};

export const activateWorkspace = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    workspace.lastAccessedAt = new Date();
    await workspace.save();

    return res.status(200).json({
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        isDefault: workspace.isDefault,
        lastAccessedAt: workspace.lastAccessedAt,
        updatedAt: workspace.updatedAt,
        permissions: getWorkspacePermissions(workspace, req.user._id),
      },
    });
  } catch (error) {
    console.error("Error activating workspace:", error);
    return res.status(500).json({ message: "Server error while activating workspace" });
  }
};

export const getWorkspaceMembers = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const permissions = getWorkspacePermissions(workspace, req.user._id);
    if (!permissions.canViewMembers) {
      return res.status(403).json({ message: "You are not allowed to view members" });
    }

    const normalizedMembers = Array.isArray(workspace.members) && workspace.members.length > 0
      ? workspace.members
      : [
          {
            user: workspace.user,
            role: "owner",
            joinedAt: workspace.createdAt || new Date(),
          },
        ];

    const memberIds = normalizedMembers.map((member) => member.user);
    const pendingIds = (workspace.pendingMembers || []).map((pending) => pending.user);
    const userDocs = await User.find({ _id: { $in: [...memberIds, ...pendingIds] } })
      .select("_id name email")
      .lean();
    const userMap = new Map(userDocs.map((user) => [toIdString(user._id), user]));

    const members = normalizedMembers.map((member) => {
      const profile = userMap.get(toIdString(member.user));
      return {
        userId: member.user,
        name: profile?.name || "Unknown",
        email: profile?.email || "unknown@example.com",
        role: member.role,
        joinedAt: member.joinedAt,
      };
    });

    const pendingMembers = permissions.canApproveMembers
      ? (workspace.pendingMembers || []).map((pending) => {
      const profile = userMap.get(toIdString(pending.user));
      return {
        userId: pending.user,
        name: profile?.name || "Unknown",
        email: profile?.email || "unknown@example.com",
        requestedAt: pending.requestedAt,
      };
    })
      : [];

    return res.status(200).json({
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        isDefault: workspace.isDefault,
      },
      permissions,
      ownerId: getWorkspaceOwnerId(workspace),
      members,
      pendingMembers,
    });
  } catch (error) {
    console.error("Error getting workspace members:", error);
    return res.status(500).json({ message: "Server error while loading workspace members" });
  }
};

export const getInviteCode = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const permissions = getWorkspacePermissions(workspace, req.user._id);
    if (!permissions.canInvite) {
      return res.status(403).json({ message: "Invite code is not available for this workspace" });
    }

    if (!workspace.inviteCode) {
      workspace.inviteCode = await createUniqueInviteCode();
      await workspace.save();
    }

    return res.status(200).json({
      inviteCode: workspace.inviteCode,
      workspace: {
        _id: workspace._id,
        name: workspace.name,
      },
    });
  } catch (error) {
    console.error("Error getting workspace invite code:", error);
    return res.status(500).json({ message: "Server error while getting invite code" });
  }
};

export const joinWorkspaceByInviteCode = async (req, res) => {
  try {
    const inviteCode = String(req.body?.inviteCode || "").trim().toUpperCase();
    if (!inviteCode) {
      return res.status(400).json({ message: "Invite code is required" });
    }

    const workspace = await Workspace.findOne({ inviteCode });
    if (!workspace || workspace.isDefault) {
      return res.status(404).json({ message: "Invite code is invalid" });
    }

    const userIdText = toIdString(req.user._id);
    const alreadyMember = (workspace.members || []).some(
      (member) => toIdString(member.user) === userIdText
    ) || toIdString(workspace.user) === userIdText;
    if (alreadyMember) {
      return res.status(409).json({ message: "You are already a member of this workspace" });
    }

    const alreadyPending = (workspace.pendingMembers || []).some(
      (pending) => toIdString(pending.user) === userIdText
    );
    if (alreadyPending) {
      return res.status(409).json({ message: "Join request already sent. Please wait for approval." });
    }

    workspace.pendingMembers = [
      ...(workspace.pendingMembers || []),
      {
        user: req.user._id,
        requestedAt: new Date(),
      },
    ];
    await workspace.save();

    await logWorkspaceActivity({
      workspaceId: workspace._id,
      actor: req.user,
      type: "member_join_requested",
      message: `${req.user.name || req.user.email} requested to join workspace`,
      metadata: {
        userId: req.user._id,
      },
    });

    return res.status(202).json({
      message: "Join request sent. Please wait for workspace owner approval.",
      workspace: {
        _id: workspace._id,
        name: workspace.name,
      },
    });
  } catch (error) {
    console.error("Error joining workspace by invite code:", error);
    return res.status(500).json({ message: "Server error while joining workspace" });
  }
};

export const approveWorkspaceMember = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const permissions = getWorkspacePermissions(workspace, req.user._id);
    if (!permissions.canApproveMembers) {
      return res.status(403).json({ message: "Only workspace owner can approve members" });
    }

    const pendingUserId = normalizeWorkspaceId(req.params.userId);
    const pendingEntry = (workspace.pendingMembers || []).find(
      (pending) => toIdString(pending.user) === pendingUserId
    );

    if (!pendingEntry) {
      return res.status(404).json({ message: "Pending member not found" });
    }

    workspace.pendingMembers = (workspace.pendingMembers || []).filter(
      (pending) => toIdString(pending.user) !== pendingUserId
    );
    workspace.members = [
      ...(workspace.members || []),
      {
        user: pendingEntry.user,
        role: "member",
        joinedAt: new Date(),
      },
    ];
    await workspace.save();

    const approvedUser = await User.findById(pendingEntry.user).select("_id name email");
    await logWorkspaceActivity({
      workspaceId: workspace._id,
      actor: req.user,
      type: "member_join_approved",
      message: `${req.user.name || req.user.email} approved ${approvedUser?.name || approvedUser?.email || "a user"} to join`,
      metadata: {
        approvedUserId: pendingEntry.user,
      },
    });

    return res.status(200).json({ message: "Member approved" });
  } catch (error) {
    console.error("Error approving workspace member:", error);
    return res.status(500).json({ message: "Server error while approving member" });
  }
};

export const rejectWorkspaceMember = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const permissions = getWorkspacePermissions(workspace, req.user._id);
    if (!permissions.canApproveMembers) {
      return res.status(403).json({ message: "Only workspace owner can reject members" });
    }

    const pendingUserId = normalizeWorkspaceId(req.params.userId);
    const beforeCount = (workspace.pendingMembers || []).length;
    const rejectedUser = (workspace.pendingMembers || []).find(
      (pending) => toIdString(pending.user) === pendingUserId
    )?.user;
    workspace.pendingMembers = (workspace.pendingMembers || []).filter(
      (pending) => toIdString(pending.user) !== pendingUserId
    );

    if ((workspace.pendingMembers || []).length === beforeCount) {
      return res.status(404).json({ message: "Pending member not found" });
    }

    await workspace.save();
    const rejectedProfile = rejectedUser
      ? await User.findById(rejectedUser).select("_id name email")
      : null;
    await logWorkspaceActivity({
      workspaceId: workspace._id,
      actor: req.user,
      type: "member_join_rejected",
      message: `${req.user.name || req.user.email} rejected ${rejectedProfile?.name || rejectedProfile?.email || "a join request"}`,
      metadata: {
        rejectedUserId: rejectedUser || pendingUserId,
      },
    });
    return res.status(200).json({ message: "Join request rejected" });
  } catch (error) {
    console.error("Error rejecting workspace member:", error);
    return res.status(500).json({ message: "Server error while rejecting member" });
  }
};

export const removeWorkspaceMember = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const permissions = getWorkspacePermissions(workspace, req.user._id);
    if (!permissions.canRemoveMembers) {
      return res.status(403).json({ message: "Only workspace owner can remove members" });
    }

    const memberUserId = normalizeWorkspaceId(req.params.memberId);
    const ownerId = getWorkspaceOwnerId(workspace);
    if (memberUserId === ownerId) {
      return res.status(400).json({ message: "Owner cannot be removed" });
    }

    const beforeCount = (workspace.members || []).length;
    const removedMember = (workspace.members || []).find(
      (member) => toIdString(member.user) === memberUserId
    );
    workspace.members = (workspace.members || []).filter(
      (member) => toIdString(member.user) !== memberUserId
    );

    if ((workspace.members || []).length === beforeCount) {
      return res.status(404).json({ message: "Member not found" });
    }

    await workspace.save();
    const removedProfile = removedMember?.user
      ? await User.findById(removedMember.user).select("_id name email")
      : null;
    await logWorkspaceActivity({
      workspaceId: workspace._id,
      actor: req.user,
      type: "member_removed",
      message: `${req.user.name || req.user.email} removed ${removedProfile?.name || removedProfile?.email || "a member"}`,
      metadata: {
        removedUserId: removedMember?.user || memberUserId,
      },
    });
    return res.status(200).json({ message: "Member removed" });
  } catch (error) {
    console.error("Error removing workspace member:", error);
    return res.status(500).json({ message: "Server error while removing member" });
  }
};

export const deleteWorkspace = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const permissions = getWorkspacePermissions(workspace, req.user._id);
    if (!permissions.canDeleteWorkspace) {
      return res.status(403).json({ message: "Only workspace owner can delete this workspace" });
    }

    await Promise.all([
      Task.deleteMany({ workspace: workspace._id }),
      WorkspaceActivity.deleteMany({ workspace: workspace._id }),
      Workspace.deleteOne({ _id: workspace._id }),
    ]);

    return res.status(200).json({ message: "Workspace deleted" });
  } catch (error) {
    console.error("Error deleting workspace:", error);
    return res.status(500).json({ message: "Server error while deleting workspace" });
  }
};

export const getWorkspaceActivities = async (req, res) => {
  try {
    const workspace = await findWorkspaceForUser(req.params.id, req.user._id);
    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    const permissions = getWorkspacePermissions(workspace, req.user._id);
    if (!permissions.canAccess) {
      return res.status(403).json({ message: "You are not allowed to view this workspace" });
    }

    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(requestedLimit) ? 50 : Math.min(Math.max(requestedLimit, 10), 200);

    const activities = await WorkspaceActivity.find({ workspace: workspace._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("_id actor actorName actorEmail type message metadata createdAt")
      .lean();

    return res.status(200).json({
      workspace: {
        _id: workspace._id,
        name: workspace.name,
      },
      activities,
    });
  } catch (error) {
    console.error("Error loading workspace activities:", error);
    return res.status(500).json({ message: "Server error while loading workspace history" });
  }
};

export const getWorkspaceNotificationsSummary = async (req, res) => {
  try {
    const userId = req.user._id;
    const requestedHours = Number.parseInt(req.query.sinceHours, 10);
    const sinceHours = Number.isNaN(requestedHours)
      ? 24
      : Math.min(Math.max(requestedHours, 1), 24 * 30);
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(requestedLimit) ? 8 : Math.min(Math.max(requestedLimit, 1), 30);

    const workspaces = await Workspace.find({
      $or: [{ user: userId }, { "members.user": userId }],
    })
      .select("_id name")
      .lean();

    if (workspaces.length === 0) {
      return res.status(200).json({
        totalNotificationCount: 0,
        workspaceSummaries: [],
      });
    }

    const workspaceIds = workspaces.map((workspace) => workspace._id);
    const workspaceNameMap = new Map(
      workspaces.map((workspace) => [toIdString(workspace._id), workspace.name || "Untitled workspace"])
    );

    const requester = await User.findById(userId).select("workspaceNotificationsSeenAt").lean();
    const sinceDate = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
    const seenAt = requester?.workspaceNotificationsSeenAt
      ? new Date(requester.workspaceNotificationsSeenAt)
      : null;
    const activityStartDate = seenAt && seenAt > sinceDate ? seenAt : sinceDate;

    const allActivities = await WorkspaceActivity.find({
      workspace: { $in: workspaceIds },
      createdAt: { $gte: activityStartDate },
    })
      .sort({ createdAt: -1 })
      .select("workspace actor type createdAt")
      .lean();

    const MAJOR_CHANGE_TYPES = new Set([
      "task_created",
      "task_updated",
      "task_deleted",
      "workspace_created",
      "member_removed",
    ]);
    const NEW_MEMBER_TYPES = new Set(["member_join_approved"]);
    const currentUserIdText = toIdString(userId);

    const summaryMap = new Map();

    allActivities.forEach((activity) => {
      const actorIdText = activity.actor ? toIdString(activity.actor) : "";
      if (actorIdText && actorIdText === currentUserIdText) {
        return;
      }

      const workspaceIdText = toIdString(activity.workspace);
      if (!summaryMap.has(workspaceIdText)) {
        summaryMap.set(workspaceIdText, {
          workspaceId: workspaceIdText,
          workspaceName: workspaceNameMap.get(workspaceIdText) || "Untitled workspace",
          majorChangeCount: 0,
          newMemberCount: 0,
          latestActivityAt: activity.createdAt,
        });
      }

      const summary = summaryMap.get(workspaceIdText);
      if (!summary.latestActivityAt || new Date(activity.createdAt) > new Date(summary.latestActivityAt)) {
        summary.latestActivityAt = activity.createdAt;
      }

      if (MAJOR_CHANGE_TYPES.has(activity.type)) {
        summary.majorChangeCount += 1;
      }

      if (NEW_MEMBER_TYPES.has(activity.type)) {
        summary.newMemberCount += 1;
      }
    });

    const workspaceSummaries = Array.from(summaryMap.values())
      .filter((summary) => summary.majorChangeCount > 0 || summary.newMemberCount > 0)
      .sort((a, b) => {
        const aWeight = a.majorChangeCount + a.newMemberCount;
        const bWeight = b.majorChangeCount + b.newMemberCount;
        if (bWeight !== aWeight) {
          return bWeight - aWeight;
        }

        return new Date(b.latestActivityAt) - new Date(a.latestActivityAt);
      })
      .slice(0, limit);

    const totalNotificationCount = workspaceSummaries.reduce(
      (sum, item) => sum + item.majorChangeCount + item.newMemberCount,
      0
    );

    return res.status(200).json({
      totalNotificationCount,
      workspaceSummaries,
      sinceHours,
      seenAt: requester?.workspaceNotificationsSeenAt || null,
    });
  } catch (error) {
    console.error("Error loading workspace notifications summary:", error);
    return res.status(500).json({ message: "Server error while loading workspace notifications" });
  }
};

export const markAllWorkspaceNotificationsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    const seenAt = new Date();

    await User.updateOne(
      { _id: userId },
      {
        $set: {
          workspaceNotificationsSeenAt: seenAt,
        },
      }
    );

    return res.status(200).json({
      message: "Marked all workspace notifications as read",
      seenAt,
    });
  } catch (error) {
    console.error("Error marking workspace notifications as read:", error);
    return res.status(500).json({ message: "Server error while updating workspace notifications" });
  }
};
