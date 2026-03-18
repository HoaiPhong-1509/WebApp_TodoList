import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { getSocketServer } from "../socket/ioStore.js";

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
