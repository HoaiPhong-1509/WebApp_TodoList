import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import { io } from "socket.io-client";
import Conversation from "../src/models/Conversation.js";
import User from "../src/models/User.js";
import { hashPassword, createAuthToken } from "../src/utils/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BASE_URL = process.env.CHAT_TEST_BASE_URL || "http://localhost:5001";
const DB_URI = process.env.MONGODB_CONNECTION_STRING;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const ensureTestUser = async ({ name, email, password }) => {
  const normalizedEmail = email.trim().toLowerCase();
  let user = await User.findOne({ email: normalizedEmail });

  if (!user) {
    user = await User.create({
      name,
      email: normalizedEmail,
      password: hashPassword(password),
      isVerified: true,
      verificationToken: null,
      verificationTokenExpiresAt: null,
    });

    return user;
  }

  user.name = name;
  user.password = hashPassword(password);
  user.isVerified = true;
  user.verificationToken = null;
  user.verificationTokenExpiresAt = null;
  await user.save();

  return user;
};

const connectClient = (token, label) =>
  new Promise((resolve, reject) => {
    const socket = io(BASE_URL, {
      auth: { token },
      transports: ["websocket"],
      timeout: 8000,
    });

    const onError = (error) => {
      socket.off("connect", onConnect);
      reject(new Error(`[${label}] connect_error: ${error?.message || "Unknown"}`));
    };

    const onConnect = () => {
      socket.off("connect_error", onError);
      resolve(socket);
    };

    socket.once("connect_error", onError);
    socket.once("connect", onConnect);
  });

const run = async () => {
  if (!DB_URI) {
    throw new Error("Missing MONGODB_CONNECTION_STRING in backend/.env");
  }

  await mongoose.connect(DB_URI);

  const userA = await ensureTestUser({
    name: "Realtime User A",
    email: "realtime.user.a@example.com",
    password: "123456",
  });

  const userB = await ensureTestUser({
    name: "Realtime User B",
    email: "realtime.user.b@example.com",
    password: "123456",
  });

  const tokenA = createAuthToken({ userId: userA._id.toString(), email: userA.email }, JWT_SECRET);
  const tokenB = createAuthToken({ userId: userB._id.toString(), email: userB.email }, JWT_SECRET);

  let conversation = await Conversation.findOne({
    type: "direct",
    participants: { $all: [userA._id, userB._id] },
    $expr: { $eq: [{ $size: "$participants" }, 2] },
  });

  if (!conversation) {
    conversation = await Conversation.create({
      type: "direct",
      participants: [userA._id, userB._id],
      createdBy: userA._id,
    });
  }

  const conversationId = conversation._id.toString();

  const socketA = await connectClient(tokenA, "A");
  const socketB = await connectClient(tokenB, "B");

  socketA.emit("chat:join", { conversationId });
  socketB.emit("chat:join", { conversationId });

  await sleep(200);

  const uniqueContent = `Realtime test ping ${Date.now()}`;

  const receivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timed out waiting for realtime message"));
    }, 8000);

    socketB.on("chat:message", (payload) => {
      if (payload?.content === uniqueContent && payload?.sender?.id === userA._id.toString()) {
        clearTimeout(timeout);
        resolve(payload);
      }
    });
  });

  const ackPromise = new Promise((resolve, reject) => {
    socketA.emit("chat:message", { conversationId, content: uniqueContent }, (ack) => {
      if (!ack?.ok) {
        reject(new Error(`Server rejected message: ${ack?.message || "Unknown error"}`));
        return;
      }

      resolve(ack.message);
    });
  });

  const [ackMessage, receivedMessage] = await Promise.all([ackPromise, receivedPromise]);

  console.log("Realtime chat test passed");
  console.log(`Conversation id: ${conversationId}`);
  console.log(`Sender message id: ${ackMessage.id}`);
  console.log(`Receiver got message id: ${receivedMessage.id}`);
  console.log(`Message content: ${receivedMessage.content}`);

  socketA.disconnect();
  socketB.disconnect();
  await mongoose.disconnect();
};

run()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Realtime chat test failed:", error.message);

    try {
      await mongoose.disconnect();
    } catch {
      // ignore cleanup errors
    }

    process.exit(1);
  });
