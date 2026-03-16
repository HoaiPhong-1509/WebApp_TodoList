import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../src/models/User.js";
import { hashPassword } from "../src/utils/auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BASE_URL = process.env.CHAT_TEST_BASE_URL || "http://localhost:5001";
const DB_URI = process.env.MONGODB_CONNECTION_STRING;

const ensureVerifiedUser = async ({ name, email, password }) => {
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

const sendJson = async ({ method, pathName, token, body }) => {
  const response = await fetch(`${BASE_URL}${pathName}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload?.message || `Request failed: ${method} ${pathName}`;
    throw new Error(message);
  }

  return payload;
};

const run = async () => {
  if (!DB_URI) {
    throw new Error("Missing MONGODB_CONNECTION_STRING in backend/.env");
  }

  await mongoose.connect(DB_URI);

  const userA = await ensureVerifiedUser({
    name: "Smoke User A",
    email: "smoke.user.a@example.com",
    password: "123456",
  });

  const userB = await ensureVerifiedUser({
    name: "Smoke User B",
    email: "smoke.user.b@example.com",
    password: "123456",
  });

  const userC = await ensureVerifiedUser({
    name: "Smoke User C",
    email: "smoke.user.c@example.com",
    password: "123456",
  });

  await mongoose.disconnect();

  const login = await sendJson({
    method: "POST",
    pathName: "/api/auth/login",
    body: {
      email: userA.email,
      password: "123456",
    },
  });

  const token = login.token;

  const me = await sendJson({ method: "GET", pathName: "/api/auth/me", token });

  const loginB = await sendJson({
    method: "POST",
    pathName: "/api/auth/login",
    body: {
      email: userB.email,
      password: "123456",
    },
  });

  const tokenB = loginB.token;

  const task = await sendJson({
    method: "POST",
    pathName: "/api/tasks",
    token,
    body: { title: `Smoke Task ${Date.now()}` },
  });

  await sendJson({ method: "GET", pathName: "/api/tasks?filter=all", token });

  await sendJson({
    method: "PUT",
    pathName: `/api/tasks/${task._id}`,
    token,
    body: { status: "completed", completedAt: new Date().toISOString() },
  });

  await sendJson({ method: "DELETE", pathName: `/api/tasks/${task._id}`, token });

  await sendJson({ method: "GET", pathName: "/api/chat/users?query=Smoke", token });

  const directConversation = await sendJson({
    method: "POST",
    pathName: "/api/chat/conversations/direct",
    token,
    body: { userId: userB._id.toString() },
  });

  const groupConversation = await sendJson({
    method: "POST",
    pathName: "/api/chat/conversations/group",
    token,
    body: {
      name: `Smoke Group ${Date.now()}`,
      memberIds: [userB._id.toString(), userC._id.toString()],
    },
  });

  await sendJson({
    method: "POST",
    pathName: `/api/chat/conversations/${directConversation.conversation.id}/messages`,
    token,
    body: { content: `Smoke message ${Date.now()}` },
  });

  await sendJson({
    method: "GET",
    pathName: `/api/chat/conversations/${directConversation.conversation.id}/messages?limit=20`,
    token,
  });

  await sendJson({
    method: "POST",
    pathName: `/api/chat/conversations/${groupConversation.conversation.id}/members`,
    token,
    body: { memberIds: [userB._id.toString()] },
  });

  const deleteForMember = await sendJson({
    method: "DELETE",
    pathName: `/api/chat/conversations/${groupConversation.conversation.id}`,
    token: tokenB,
  });

  if (deleteForMember.deletedForAll !== false) {
    throw new Error("Member should only delete conversation for themselves");
  }

  const conversationsForB = await sendJson({
    method: "GET",
    pathName: "/api/chat/conversations",
    token: tokenB,
  });

  if (conversationsForB.conversations.some((conversation) => conversation.id === groupConversation.conversation.id)) {
    throw new Error("Conversation should be hidden for member after delete-for-me");
  }

  const conversationsForAAfterMemberDelete = await sendJson({
    method: "GET",
    pathName: "/api/chat/conversations",
    token,
  });

  if (!conversationsForAAfterMemberDelete.conversations.some((conversation) => conversation.id === groupConversation.conversation.id)) {
    throw new Error("Conversation should remain for creator after member deletes for self");
  }

  await sendJson({
    method: "POST",
    pathName: `/api/chat/conversations/${groupConversation.conversation.id}/leave`,
    token: tokenB,
  });

  const dissolveByCreator = await sendJson({
    method: "DELETE",
    pathName: `/api/chat/conversations/${groupConversation.conversation.id}`,
    token,
  });

  if (dissolveByCreator.deletedForAll !== true) {
    throw new Error("Creator should be able to dissolve group for all");
  }

  console.log("Web app smoke test passed");
  console.log(`Authenticated user: ${me.user.email}`);
  console.log(`Direct conversation id: ${directConversation.conversation.id}`);
  console.log(`Group conversation id: ${groupConversation.conversation.id}`);
};

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Web app smoke test failed:", error.message);
    process.exit(1);
  });
