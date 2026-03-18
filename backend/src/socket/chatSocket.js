import { Server } from "socket.io";
import Conversation from "../models/Conversation.js";
import Message from "../models/Message.js";
import User from "../models/User.js";
import { chatSerializer } from "../controllers/chatControllers.js";
import { setSocketServer } from "./ioStore.js";
import { verifyAuthToken } from "../utils/auth.js";

const configuredCorsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const allowedOrigins = [...new Set(["http://localhost:5173", ...configuredCorsOrigins])];

const conversationRoom = (conversationId) => `conversation:${conversationId}`;
const userRoom = (userId) => `user:${userId}`;

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

const getSocketToken = (socket) => {
  const authToken = socket.handshake.auth?.token;
  if (authToken) {
    return authToken;
  }

  const authorization = socket.handshake.headers?.authorization;
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

const getOnlineCount = (io, room) => {
  const activeRoom = io.sockets.adapter.rooms.get(room);
  return activeRoom ? activeRoom.size : 0;
};

const joinConversationRooms = async (socket) => {
  const conversations = await Conversation.find({
    participants: socket.user.id,
    deletedFor: { $ne: socket.user.id },
  }).select("_id");
  conversations.forEach((conversation) => {
    socket.join(conversationRoom(conversation._id));
  });
};

const emitConversationUpdate = (io, conversation, currentUserId) => {
  conversation.participants.forEach((participant) => {
    io.to(userRoom(participant._id)).emit("chat:conversation:update", {
      conversation: chatSerializer.toConversationResponse(conversation, participant._id || currentUserId),
    });
  });
};

export const setupSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error("Not allowed by CORS"));
      },
      methods: ["GET", "POST"],
    },
  });

  io.use(async (socket, next) => {
    try {
      const token = getSocketToken(socket);
      if (!token) {
        return next(new Error("Unauthorized"));
      }

      const secret = process.env.JWT_SECRET || "dev_secret_change_me";
      const payload = verifyAuthToken(token, secret);
      const user = await User.findById(payload.userId).select("_id name email");

      if (!user) {
        return next(new Error("Unauthorized"));
      }

      socket.user = {
        id: user._id,
        name: user.name,
        email: user.email,
      };

      return next();
    } catch {
      return next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    socket.join(userRoom(socket.user.id));

    try {
      await joinConversationRooms(socket);
    } catch (error) {
      console.error("Failed to join conversation rooms:", error);
    }

    socket.on("chat:join", async ({ conversationId }, acknowledge) => {
      try {
        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: socket.user.id,
        }).populate("participants", "_id name email");

        if (!conversation) {
          acknowledge?.({ ok: false, message: "Conversation not found" });
          return;
        }

        const unreadCounts = ensureUnreadCountMap(conversation);
        const myUserKey = socket.user.id.toString();
        if (Number(unreadCounts.get(myUserKey) || 0) > 0) {
          unreadCounts.set(myUserKey, 0);
          await conversation.save();
          io.to(userRoom(socket.user.id)).emit("chat:conversation:update", {
            conversation: chatSerializer.toConversationResponse(conversation, socket.user.id),
          });
        }

        const room = conversationRoom(conversationId);
        socket.join(room);
        io.to(room).emit("chat:presence", {
          conversationId,
          onlineCount: getOnlineCount(io, room),
        });

        acknowledge?.({ ok: true });
      } catch {
        acknowledge?.({ ok: false, message: "Unable to join conversation" });
      }
    });

    socket.on("chat:typing", async ({ conversationId, isTyping }) => {
      if (!conversationId) {
        return;
      }

      const conversation = await Conversation.findOne({
        _id: conversationId,
        participants: socket.user.id,
      }).select("_id");

      if (!conversation) {
        return;
      }

      socket.to(conversationRoom(conversationId)).emit("chat:typing", {
        conversationId,
        user: socket.user,
        isTyping: Boolean(isTyping),
      });
    });

    socket.on("chat:message", async ({ conversationId, content }, acknowledge) => {
      try {
        const normalizedContent = typeof content === "string" ? content.trim() : "";

        if (!conversationId) {
          acknowledge?.({ ok: false, message: "conversationId is required" });
          return;
        }

        if (!normalizedContent) {
          acknowledge?.({ ok: false, message: "Message content is required" });
          return;
        }

        const conversation = await Conversation.findOne({
          _id: conversationId,
          participants: socket.user.id,
        }).populate("participants", "_id name email");

        if (!conversation) {
          acknowledge?.({ ok: false, message: "Conversation not found" });
          return;
        }

        const message = await Message.create({
          conversation: conversationId,
          sender: socket.user.id,
          content: normalizedContent,
        });

        await message.populate("sender", "_id name email");

        conversation.lastMessage = {
          content: normalizedContent,
          sender: socket.user.id,
          createdAt: message.createdAt,
        };
        applyUnreadCountsAfterSend(conversation, socket.user.id);
        conversation.deletedFor = [];
        conversation.updatedAt = new Date();
        await conversation.save();

        const serializedMessage = chatSerializer.toMessageResponse(message);
        io.to(conversationRoom(conversationId)).emit("chat:message", serializedMessage);
        emitConversationUpdate(io, conversation, socket.user.id);

        acknowledge?.({ ok: true, message: serializedMessage });
      } catch (error) {
        console.error("Error sending socket chat message:", error);
        acknowledge?.({ ok: false, message: "Unable to send message" });
      }
    });

    socket.on("disconnect", async () => {
      try {
        const conversations = await Conversation.find({ participants: socket.user.id }).select("_id");
        conversations.forEach((conversation) => {
          const room = conversationRoom(conversation._id);
          io.to(room).emit("chat:presence", {
            conversationId: conversation._id,
            onlineCount: getOnlineCount(io, room),
          });
        });
      } catch (error) {
        console.error("Error updating conversation presence on disconnect:", error);
      }
    });
  });

  setSocketServer(io);

  return io;
};
