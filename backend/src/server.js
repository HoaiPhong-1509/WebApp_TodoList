import express from "express";
import http from "http";
import tasksRoute from "./routes/tasksRouters.js";
import authRoute from "./routes/authRouters.js";
import chatRoute from "./routes/chatRouters.js";
import workspacesRoute from "./routes/workspacesRouters.js";
import { connectDB } from "./config/db.js";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { setupSocketServer } from "./socket/chatSocket.js";

dotenv.config();

const PORT = process.env.PORT || 5001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// backend/src -> repo root
const ROOT_DIR = path.resolve(__dirname, "../..");
const FRONTEND_DIST_DIR = path.join(ROOT_DIR, "frontend", "dist");

const configuredCorsOrigins = (process.env.CORS_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set(["http://localhost:5173", ...configuredCorsOrigins])];

const app = express();
const httpServer = http.createServer(app);

app.set("trust proxy", 1);
app.use(express.json());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
  })
);

app.use("/api/tasks", tasksRoute);
app.use("/api/auth", authRoute);
app.use("/api/chat", chatRoute);
app.use("/api/workspaces", workspacesRoute);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(FRONTEND_DIST_DIR));

  // SPA fallback for non-API routes only
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(FRONTEND_DIST_DIR, "index.html"));
  });
}

connectDB().then(() => {
  setupSocketServer(httpServer);
  httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`FRONTEND_DIST_DIR=${FRONTEND_DIST_DIR}`);
  });
});