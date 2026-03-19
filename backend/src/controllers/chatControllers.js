import fs from "fs";
import path from "path";
// Load UI/UX schema for assistant context
let UIUX_SCHEMA = null;
try {
  const schemaPath = path.resolve(__dirname, "../../assistant-uiux-schema.json");
  UIUX_SCHEMA = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
} catch (e) {
  UIUX_SCHEMA = null;
}
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import Workspace from "../models/Workspace.js";
import { getSocketServer } from "../socket/ioStore.js";
import { generateGroqAssistantReply } from "../services/groqAdvisorService.js";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const userRoom = (userId) => `user:${userId}`;

const uniqueIds = (values) => [...new Set(values.map((value) => value.toString()))];

const normalizeText = (value) => (value || "").toString().trim().toLowerCase();

const matchScore = (target, query) => {
  if (!target || !query) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (target === query) {
    return 0;
  }

  if (target.startsWith(query)) {
    return 1;
  }

  const includeIndex = target.indexOf(query);
  if (includeIndex !== -1) {
    return 5 + includeIndex;
  }

  let samePrefix = 0;
  for (let index = 0; index < Math.min(target.length, query.length); index += 1) {
    if (target[index] !== query[index]) {
      break;
    }

    samePrefix += 1;
  }

  return 100 + (query.length - samePrefix);
};

const userSearchScore = (user, rawQuery) => {
  const query = normalizeText(rawQuery);
  const name = normalizeText(user.name);
  const email = normalizeText(user.email);

  return Math.min(matchScore(name, query), matchScore(email, query));
};

const toUserSummary = (userDoc) => ({
  id: userDoc._id,
  name: userDoc.name,
  email: userDoc.email,
});

const getUnreadCountForUser = (conversationDoc, userId) => {
  const userKey = userId.toString();
  const unreadCounts = conversationDoc.unreadCounts;

  if (!unreadCounts) {
    return 0;
  }

  if (typeof unreadCounts.get === "function") {
    return Number(unreadCounts.get(userKey) || 0);
  }

  return Number(unreadCounts[userKey] || 0);
};

const ensureUnreadCountMap = (conversationDoc) => {
  if (!conversationDoc.unreadCounts || typeof conversationDoc.unreadCounts.get !== "function") {
    conversationDoc.unreadCounts = new Map(Object.entries(conversationDoc.unreadCounts || {}));
  }

  return conversationDoc.unreadCounts;
};

const applyUnreadCountsAfterSend = (conversationDoc, senderId) => {
  const unreadCounts = ensureUnreadCountMap(conversationDoc);
  const senderKey = senderId.toString();

  conversationDoc.participants.forEach((participant) => {
    const participantKey = (participant._id || participant).toString();

    if (participantKey === senderKey) {
      unreadCounts.set(participantKey, 0);
      return;
    }

    unreadCounts.set(participantKey, Number(unreadCounts.get(participantKey) || 0) + 1);
  });
};

const toConversationResponse = (conversationDoc, currentUserId) => {
  const me = currentUserId.toString();
  const participants = (conversationDoc.participants || []).map(toUserSummary);
  const peerUsers = participants.filter((participant) => participant.id.toString() !== me);

  let title;
  if (conversationDoc.type === "group") {
    title = conversationDoc.name || peerUsers.map((user) => user.name).join(", ") || "Untitled group";
  } else {
    title = peerUsers[0]?.name || "Direct chat";
  }

  return {
    id: conversationDoc._id,
    type: conversationDoc.type,
    name: conversationDoc.name,
    title,
    createdBy: conversationDoc.createdBy,
    permissions: {
      canDissolve: conversationDoc.type === "group" && conversationDoc.createdBy?.toString() === me,
      canLeave: conversationDoc.type === "group" && conversationDoc.createdBy?.toString() !== me,
    },
    participants,
    lastMessage: conversationDoc.lastMessage || null,
    unreadCount: getUnreadCountForUser(conversationDoc, currentUserId),
    updatedAt: conversationDoc.updatedAt,
    createdAt: conversationDoc.createdAt,
  };
};

const toMessageResponse = (messageDoc) => ({
  id: messageDoc._id,
  conversationId: messageDoc.conversation,
  sender: toUserSummary(messageDoc.sender),
  content: messageDoc.content,
  createdAt: messageDoc.createdAt,
  updatedAt: messageDoc.updatedAt,
});

const ensureConversationMembership = async (conversationId, userId) => {
  const conversation = await Conversation.findOne({
    _id: conversationId,
    participants: userId,
  }).populate("participants", "_id name email");

  return conversation;
};

const normalizeAssistantHistory = (history = []) => {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-8)
    .map((entry) => {
      const role = entry?.role === "assistant" ? "assistant" : "user";
      const content = String(entry?.content || "").trim().slice(0, 1200);

      if (!content) {
        return null;
      }

      return { role, content };
    })
    .filter(Boolean);
};

const ASSISTANT_INTENT = {
  WORKSPACE_JOIN: "workspace_join",
  WORKSPACE_INVITE: "workspace_invite",
  WORKSPACE_APPROVAL: "workspace_approval",
  TASK_CREATE: "task_create",
  TASK_PRIORITIZATION: "task_prioritization",
  PRODUCTIVITY_COACHING: "productivity_coaching",
  GENERAL: "general",
};

const detectAssistantIntent = (rawPrompt) => {
  const prompt = normalizeText(rawPrompt);

  if (
    /(join workspace|tham gia workspace|vao workspace|vào workspace|join ws|ma moi|mã mời|invite code|join-by-code)/i.test(
      prompt
    )
  ) {
    return ASSISTANT_INTENT.WORKSPACE_JOIN;
  }

  if (/(invite|moi thanh vien|mời thành viên|ma moi|mã mời|share code)/i.test(prompt)) {
    return ASSISTANT_INTENT.WORKSPACE_INVITE;
  }

  if (/(duyet|duyệt|approve|pending member|cho phep tham gia|phê duyệt)/i.test(prompt)) {
    return ASSISTANT_INTENT.WORKSPACE_APPROVAL;
  }

  if (/(tao viec|tạo việc|tao task|tạo task|them viec|thêm việc|add task|create task)/i.test(prompt)) {
    return ASSISTANT_INTENT.TASK_CREATE;
  }

  if (/(uu tien|ưu tiên|priority|quan trong|quan trọng|khẩn cấp|urgent|deadline)/i.test(prompt)) {
    return ASSISTANT_INTENT.TASK_PRIORITIZATION;
  }

  if (/(qua tai|quá tải|stress|met|mệt|roi|rối|nang suat|năng suất|productivity)/i.test(prompt)) {
    return ASSISTANT_INTENT.PRODUCTIVITY_COACHING;
  }

  return ASSISTANT_INTENT.GENERAL;
};

const extractInviteCode = (rawPrompt) => {
  const prompt = String(rawPrompt || "").toUpperCase();
  const match = prompt.match(/\b[A-HJ-NP-Z2-9]{6,12}\b/);
  return match?.[0] || null;
};

const toWorkspaceState = async (userId) => {
  const [
    ownedWorkspaces,
    memberWorkspaces,
    pendingJoinedDocs,
    ownedPendingDocs,
    recentWorkspace,
  ] = await Promise.all([
    Workspace.countDocuments({ user: userId }),
    Workspace.countDocuments({ "members.user": userId, user: { $ne: userId } }),
    Workspace.find({ "pendingMembers.user": userId })
      .select("_id name pendingMembers")
      .lean(),
    Workspace.find({ user: userId, "pendingMembers.0": { $exists: true } })
      .select("_id name pendingMembers")
      .lean(),
    Workspace.findOne({
      $or: [{ user: userId }, { "members.user": userId }],
    })
      .select("_id name inviteCode lastAccessedAt")
      .sort({ lastAccessedAt: -1, updatedAt: -1 })
      .lean(),
  ]);

  const pendingJoinedWorkspaceNames = pendingJoinedDocs
    .map((workspace) => workspace.name)
    .filter(Boolean)
    .slice(0, 5);

  const approvalsNeeded = ownedPendingDocs.reduce(
    (sum, workspace) => sum + Number(Array.isArray(workspace.pendingMembers) ? workspace.pendingMembers.length : 0),
    0
  );

  return {
    ownedWorkspaces,
    memberWorkspaces,
    pendingJoinRequests: pendingJoinedDocs.length,
    pendingJoinWorkspaceNames: pendingJoinedWorkspaceNames,
    approvalsNeeded,
    hasRecentWorkspace: Boolean(recentWorkspace?._id),
    recentWorkspace: recentWorkspace
      ? {
          id: recentWorkspace._id,
          name: recentWorkspace.name,
          inviteCode: recentWorkspace.inviteCode || null,
        }
      : null,
  };
};

const buildAssistantRoutingContext = async ({ user, prompt }) => {
  const intent = detectAssistantIntent(prompt);
  const inviteCodeCandidate = extractInviteCode(prompt);
  const workspaceState = await toWorkspaceState(user._id);

  return {
    intent,
    inviteCodeCandidate,
    workspaceState,
    user: {
      id: user._id,
      name: user.name || null,
      email: user.email || null,
    },
  };
};

const buildAssistantContextInstruction = (assistantContext) => {
  const { intent, inviteCodeCandidate, workspaceState } = assistantContext;

  return [
    "Bạn là trợ lý trong ứng dụng Task Management App.",
    "Luôn trả lời theo dữ liệu ngữ cảnh được cấp, không dùng câu trả lời rập khuôn.",
    "Nếu người dùng hỏi thao tác trong hệ thống, hãy đưa các bước ngắn, đúng theo workflow thật.",
    "Nếu thiếu thông tin, hỏi thêm tối đa 1 câu làm rõ.",
    `intent=${intent}`,
    `inviteCodeCandidate=${inviteCodeCandidate || "none"}`,
    `workspaceState=${JSON.stringify(workspaceState)}`,
    "Task schema hiện có: title (string, required), workspaceId (required theo ngữ cảnh), status (todo|in_progress|completed, mặc định todo).",
    "Không được yêu cầu hoặc gợi ý các field không tồn tại trong app như description, deadline, priority, task type.",
    "Nếu user muốn tạo task, chỉ hướng dẫn theo title + workspace và nhắc status mặc định là todo.",
    "Workflow workspace hiện có: join bằng invite code sẽ tạo pending request và cần owner approve.",
    "Endpoint tương ứng: POST /api/workspaces/join-by-code (body: inviteCode).",
    "Endpoint tạo task: POST /api/tasks (body tối thiểu: title, workspaceId).",
    "Owner duyệt thành viên tại endpoint POST /api/workspaces/:id/pending/:userId/approve.",
    UIUX_SCHEMA ? `UI/UX SCHEMA: ${JSON.stringify(UIUX_SCHEMA)}` : "",
    "Chỉ hướng dẫn thao tác đúng với UI/UX thực tế trong UI/UX SCHEMA. Nếu user hỏi thao tác không có trong schema này, trả lời: 'Tính năng này chưa có trên giao diện hiện tại.'"
  ].join("\n");
};

const buildFallbackAssistantReply = (rawPrompt, assistantContext = null) => {
  const prompt = String(rawPrompt || "").trim();
  const lowerPrompt = prompt.toLowerCase();

  const intent = assistantContext?.intent || ASSISTANT_INTENT.GENERAL;
  const workspaceState = assistantContext?.workspaceState || null;
  const inviteCodeCandidate = assistantContext?.inviteCodeCandidate || null;

  if (intent === ASSISTANT_INTENT.WORKSPACE_JOIN) {
    const pendingJoinRequests = Number(workspaceState?.pendingJoinRequests || 0);
    const pendingNames = workspaceState?.pendingJoinWorkspaceNames || [];

    const lines = ["Để tham gia workspace, bạn cần mã mời từ owner/admin của workspace đó."];

    if (inviteCodeCandidate) {
      lines.push(`Bạn đã cung cấp mã ${inviteCodeCandidate}. Hãy vào mục Workspace và nhập mã này để gửi yêu cầu tham gia.`);
    } else {
      lines.push("Khi có mã mời, vào Workspace -> Join by code -> nhập mã -> gửi yêu cầu.");
    }

    lines.push("Sau khi gửi, owner sẽ cần phê duyệt thì bạn mới vào workspace được.");

    if (pendingJoinRequests > 0) {
      const workspaceHint = pendingNames.length > 0 ? ` (${pendingNames.join(", ")})` : "";
      lines.push(`Hiện tài khoản của bạn đang có ${pendingJoinRequests} yêu cầu chờ duyệt${workspaceHint}.`);
    }

    return lines.join(" ");
  }

  if (intent === ASSISTANT_INTENT.WORKSPACE_INVITE) {
    const recentWorkspaceName = workspaceState?.recentWorkspace?.name;
    return recentWorkspaceName
      ? `Bạn có thể mở workspace "${recentWorkspaceName}", lấy Invite code và gửi cho thành viên. Khi họ join bằng code, yêu cầu sẽ vào danh sách chờ để bạn duyệt.`
      : "Bạn có thể mở workspace cần mời, lấy Invite code rồi gửi cho thành viên. Khi họ join bằng code, yêu cầu sẽ vào danh sách chờ duyệt.";
  }

  if (intent === ASSISTANT_INTENT.WORKSPACE_APPROVAL) {
    const approvalsNeeded = Number(workspaceState?.approvalsNeeded || 0);
    if (approvalsNeeded > 0) {
      return `Hiện bạn có ${approvalsNeeded} yêu cầu tham gia đang chờ duyệt trong các workspace bạn sở hữu. Vào Members/Pending để Approve hoặc Reject từng người.`;
    }

    return "Bạn có thể duyệt thành viên tại mục Members/Pending của workspace bạn sở hữu. Hiện chưa thấy yêu cầu chờ duyệt nào.";
  }

  if (intent === ASSISTANT_INTENT.TASK_CREATE) {
    const recentWorkspaceName = workspaceState?.recentWorkspace?.name;
    const workspaceHint = recentWorkspaceName
      ? ` trong workspace "${recentWorkspaceName}"`
      : " trong workspace bạn đang chọn";

    return [
      `Để tạo task${workspaceHint}, app hiện chỉ cần 2 thông tin: title và workspace.`,
      "Ví dụ đúng: title = \"Làm bài tập DA_CNTT\".",
      "Sau khi tạo, status mặc định là todo; bạn có thể đổi sang in_progress hoặc completed sau.",
      "Lưu ý: app chưa có các trường description, deadline, priority hoặc task type.",
    ].join(" ");
  }

  if (!prompt) {
    return "Bạn có thể mô tả mục tiêu hiện tại và 2-3 task bạn đang vướng để mình tư vấn cụ thể hơn.";
  }

  if (/(gấp|khẩn|deadline|urgent|trễ)/i.test(lowerPrompt)) {
    return "Mình đề xuất xử lý theo thứ tự: (1) Chọn 1 task quan trọng nhất cho deadline gần nhất. (2) Cắt task đó thành bước 30-45 phút và làm ngay bước đầu. (3) Tạm hoãn mọi task không ảnh hưởng deadline trong hôm nay.";
  }

  if (/(quá tải|nhiều việc|rối|stress|mệt)/i.test(lowerPrompt)) {
    return "Bạn đang có dấu hiệu quá tải. Hãy thử: (1) Giới hạn tối đa 3 task trong trạng thái In Progress. (2) Hoàn thành 1 task nhỏ trong 25 phút để lấy đà. (3) Chuyển các việc chưa cần thiết sang backlog để giảm áp lực nhận thức.";
  }

  if (/(ưu tiên|priority|quan trọng)/i.test(lowerPrompt)) {
    return "Cách ưu tiên nhanh: dùng ma trận Tác động x Khẩn cấp. Chọn 1 task tác động cao + khẩn cấp làm trước, 1 task tác động cao nhưng không khẩn cấp lên lịch, còn lại đưa về backlog để tránh dàn trải.";
  }

  return "Mình gợi ý 3 bước hành động: (1) Nêu rõ kết quả cần đạt trong hôm nay bằng 1 câu. (2) Chọn 1 việc quan trọng nhất và chia thành bước nhỏ có thể làm trong 30-60 phút. (3) Sau khi xong bước đầu, cập nhật lại để mình đề xuất bước tiếp theo chính xác hơn.";
};

export const chatWithAssistant = async (req, res) => {
  try {
    const prompt = typeof req.body.prompt === "string" ? req.body.prompt.trim() : "";
    const history = normalizeAssistantHistory(req.body.history);

    if (!prompt) {
      return res.status(400).json({ message: "prompt is required" });
    }

    const assistantContext = await buildAssistantRoutingContext({
      user: req.user,
      prompt,
    });

    const contextInstruction = buildAssistantContextInstruction(assistantContext);

    try {
      const groqResult = await generateGroqAssistantReply({
        prompt,
        history,
        contextInstruction,
      });

      if (groqResult?.reply) {
        return res.status(200).json({
          reply: groqResult.reply,
          provider: groqResult.provider,
          model: groqResult.model,
          fallbackUsed: false,
        });
      }
    } catch (assistantError) {
      console.warn("Groq assistant failed, using fallback:", {
        code: assistantError?.code,
        message: assistantError?.message,
      });
    }

    return res.status(200).json({
      reply: buildFallbackAssistantReply(prompt, assistantContext),
      provider: "rule-based",
      fallbackUsed: true,
      intent: assistantContext.intent,
    });
  } catch (error) {
    console.error("Error chatting with AI assistant:", error);
    return res.status(500).json({ message: "Server error while chatting with assistant" });
  }
};

export const searchUsers = async (req, res) => {
  try {
    const query = (req.query.query || "").trim();

    if (!query) {
      return res.status(200).json({ users: [] });
    }

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [
        { name: { $regex: query, $options: "i" } },
        { email: { $regex: query, $options: "i" } },
      ],
    })
      .select("_id name email");

    const rankedUsers = users
      .map((user) => ({
        user,
        score: userSearchScore(user, query),
      }))
      .sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }

        return a.user.name.localeCompare(b.user.name);
      })
      .slice(0, 20)
      .map(({ user }) => user);

    return res.status(200).json({ users: rankedUsers.map(toUserSummary) });
  } catch (error) {
    console.error("Error searching users:", error);
    return res.status(500).json({ message: "Server error while searching users" });
  }
};

export const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      participants: req.user._id,
      deletedFor: { $ne: req.user._id },
    })
      .populate("participants", "_id name email")
      .sort({ updatedAt: -1 });

    return res.status(200).json({
      conversations: conversations.map((conversation) => toConversationResponse(conversation, req.user._id)),
    });
  } catch (error) {
    console.error("Error fetching conversations:", error);
    return res.status(500).json({ message: "Server error while fetching conversations" });
  }
};

export const createDirectConversation = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const peerUser = await User.findById(userId).select("_id name email");
    if (!peerUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const meId = req.user._id.toString();
    const peerId = peerUser._id.toString();

    if (meId === peerId) {
      return res.status(400).json({ message: "Cannot create direct chat with yourself" });
    }

    let conversation = await Conversation.findOne({
      type: "direct",
      participants: { $all: [req.user._id, peerUser._id] },
      $expr: { $eq: [{ $size: "$participants" }, 2] },
    }).populate("participants", "_id name email");

    if (!conversation) {
      conversation = await Conversation.create({
        type: "direct",
        participants: [req.user._id, peerUser._id],
        deletedFor: [],
        createdBy: req.user._id,
        unreadCounts: {
          [req.user._id.toString()]: 0,
          [peerUser._id.toString()]: 0,
        },
      });

      conversation = await conversation.populate("participants", "_id name email");
    } else if ((conversation.deletedFor || []).some((id) => id.toString() === req.user._id.toString())) {
      conversation.deletedFor = (conversation.deletedFor || []).filter(
        (id) => id.toString() !== req.user._id.toString()
      );
      await conversation.save();
    }

    return res.status(201).json({
      conversation: toConversationResponse(conversation, req.user._id),
    });
  } catch (error) {
    console.error("Error creating direct conversation:", error);
    return res.status(500).json({ message: "Server error while creating direct conversation" });
  }
};

export const createGroupConversation = async (req, res) => {
  try {
    const { name, memberIds = [] } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Group name is required" });
    }

    const participantIds = uniqueIds([req.user._id.toString(), ...memberIds]);

    if (participantIds.length < 3) {
      return res.status(400).json({ message: "Group chat needs at least 3 members including you" });
    }

    const users = await User.find({ _id: { $in: participantIds } }).select("_id name email");
    if (users.length !== participantIds.length) {
      return res.status(400).json({ message: "One or more users were not found" });
    }

    const conversation = await Conversation.create({
      type: "group",
      name: name.trim(),
      participants: participantIds,
      deletedFor: [],
      createdBy: req.user._id,
      unreadCounts: participantIds.reduce((acc, participantId) => {
        acc[participantId] = 0;
        return acc;
      }, {}),
    });

    await conversation.populate("participants", "_id name email");

    return res.status(201).json({
      conversation: toConversationResponse(conversation, req.user._id),
    });
  } catch (error) {
    console.error("Error creating group conversation:", error);
    return res.status(500).json({ message: "Server error while creating group conversation" });
  }
};

export const addConversationMembers = async (req, res) => {
  try {
    const { id } = req.params;
    const { memberIds = [] } = req.body;

    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ message: "memberIds must be a non-empty array" });
    }

    const conversation = await ensureConversationMembership(id, req.user._id);

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (conversation.type !== "group") {
      return res.status(400).json({ message: "Members can only be added to group conversations" });
    }

    const existingParticipantIds = uniqueIds(conversation.participants.map((participant) => participant._id));
    const nextParticipantIds = uniqueIds([...existingParticipantIds, ...memberIds]);

    const users = await User.find({ _id: { $in: nextParticipantIds } }).select("_id name email");
    if (users.length !== nextParticipantIds.length) {
      return res.status(400).json({ message: "One or more users were not found" });
    }

    conversation.participants = nextParticipantIds;
    const unreadCounts = ensureUnreadCountMap(conversation);
    nextParticipantIds.forEach((participantId) => {
      unreadCounts.set(participantId.toString(), Number(unreadCounts.get(participantId.toString()) || 0));
    });
    conversation.deletedFor = (conversation.deletedFor || []).filter(
      (deletedUserId) => nextParticipantIds.includes(deletedUserId.toString())
    );
    await conversation.save();
    await conversation.populate("participants", "_id name email");

    return res.status(200).json({
      conversation: toConversationResponse(conversation, req.user._id),
    });
  } catch (error) {
    console.error("Error adding conversation members:", error);
    return res.status(500).json({ message: "Server error while adding members" });
  }
};

export const getConversationMessages = async (req, res) => {
  try {
    const { id } = req.params;
    const requestedLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isNaN(requestedLimit)
      ? DEFAULT_LIMIT
      : Math.min(Math.max(requestedLimit, 1), MAX_LIMIT);

    const before = req.query.before;
    const conversation = await ensureConversationMembership(id, req.user._id);

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const meId = req.user._id.toString();
    const unreadCounts = ensureUnreadCountMap(conversation);
    if (Number(unreadCounts.get(meId) || 0) > 0) {
      unreadCounts.set(meId, 0);
      await conversation.save();
    }

    const query = {
      conversation: id,
      ...(before ? { createdAt: { $lt: new Date(before) } } : {}),
    };

    const messages = await Message.find(query)
      .populate("sender", "_id name email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.status(200).json({
      conversation: toConversationResponse(conversation, req.user._id),
      messages: messages.reverse().map(toMessageResponse),
    });
  } catch (error) {
    console.error("Error fetching conversation messages:", error);
    return res.status(500).json({ message: "Server error while fetching conversation messages" });
  }
};

export const createMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const content = typeof req.body.content === "string" ? req.body.content.trim() : "";

    if (!content) {
      return res.status(400).json({ message: "Message content is required" });
    }

    const conversation = await ensureConversationMembership(id, req.user._id);

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const message = await Message.create({
      conversation: id,
      sender: req.user._id,
      content,
    });

    await message.populate("sender", "_id name email");

    conversation.lastMessage = {
      content,
      sender: req.user._id,
      createdAt: message.createdAt,
    };
    applyUnreadCountsAfterSend(conversation, req.user._id);
    conversation.deletedFor = [];
    conversation.updatedAt = new Date();
    await conversation.save();

    return res.status(201).json({ message: toMessageResponse(message) });
  } catch (error) {
    console.error("Error creating message:", error);
    return res.status(500).json({ message: "Server error while sending message" });
  }
};

export const deleteConversation = async (req, res) => {
  try {
    const { id } = req.params;

    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.user._id,
    });

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    const io = getSocketServer();
    const isCreator = conversation.createdBy.toString() === req.user._id.toString();

    if (conversation.type === "group" && isCreator) {
      const participantIds = (conversation.participants || []).map((participant) => participant.toString());

      await Message.deleteMany({ conversation: id });
      await Conversation.deleteOne({ _id: id });

      if (io) {
        participantIds.forEach((participantId) => {
          io.to(userRoom(participantId)).emit("chat:conversation:deleted", {
            conversationId: id,
          });
        });
      }

      return res.status(200).json({
        message: "Group dissolved successfully",
        conversationId: id,
        deletedForAll: true,
      });
    }

    if (conversation.type === "group" && !isCreator) {
      conversation.deletedFor = uniqueIds([...(conversation.deletedFor || []), req.user._id]);
      await conversation.save();

      if (io) {
        io.to(userRoom(req.user._id)).emit("chat:conversation:deleted", {
          conversationId: id,
        });
      }

      return res.status(200).json({
        message: "Conversation deleted for you",
        conversationId: id,
        deletedForAll: false,
      });
    }

    conversation.deletedFor = uniqueIds([...(conversation.deletedFor || []), req.user._id]);
    await conversation.save();

    if (io) {
      io.to(userRoom(req.user._id)).emit("chat:conversation:deleted", {
        conversationId: id,
      });
    }

    return res.status(200).json({
      message: "Conversation deleted for you",
      conversationId: id,
      deletedForAll: false,
    });
  } catch (error) {
    console.error("Error deleting conversation:", error);
    return res.status(500).json({ message: "Server error while deleting conversation" });
  }
};

export const leaveConversation = async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await Conversation.findOne({
      _id: id,
      participants: req.user._id,
    }).populate("participants", "_id name email");

    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    if (conversation.type !== "group") {
      return res.status(400).json({ message: "Only group conversations can be left" });
    }

    if (conversation.createdBy.toString() === req.user._id.toString()) {
      return res.status(400).json({ message: "Group creator cannot leave. Dissolve the group instead." });
    }

    conversation.participants = conversation.participants.filter(
      (participant) => participant._id.toString() !== req.user._id.toString()
    );
    const unreadCounts = ensureUnreadCountMap(conversation);
    unreadCounts.delete(req.user._id.toString());
    conversation.deletedFor = (conversation.deletedFor || []).filter(
      (deletedUserId) => deletedUserId.toString() !== req.user._id.toString()
    );
    await conversation.save();

    const io = getSocketServer();
    if (io) {
      io.to(userRoom(req.user._id)).emit("chat:conversation:deleted", {
        conversationId: id,
      });

      conversation.participants.forEach((participant) => {
        io.to(userRoom(participant._id)).emit("chat:conversation:update", {
          conversation: chatSerializer.toConversationResponse(conversation, participant._id),
        });
      });
    }

    return res.status(200).json({
      message: "Left group conversation successfully",
      conversationId: id,
    });
  } catch (error) {
    console.error("Error leaving conversation:", error);
    return res.status(500).json({ message: "Server error while leaving conversation" });
  }
};

export const chatSerializer = {
  toConversationResponse,
  toMessageResponse,
};
