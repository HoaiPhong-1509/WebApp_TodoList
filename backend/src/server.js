import express from 'express';
import http from 'http';
import tasksRoute from './routes/tasksRouters.js';
import authRoute from './routes/authRouters.js';
import chatRoute from './routes/chatRouters.js';
import { connectDB } from './config/db.js';
import dotenv from 'dotenv';
import cors from 'cors';
import path from 'path';
import { setupSocketServer } from './socket/chatSocket.js';

dotenv.config();

const PORT = process.env.PORT || 5001;
const __dirname = path.resolve();
const configuredCorsOrigins = (process.env.CORS_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
const allowedOrigins = [...new Set(["http://localhost:5173", ...configuredCorsOrigins])];

const app = express();
const httpServer = http.createServer(app);
 
//middleware
app.use(express.json());
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(new Error("Not allowed by CORS"));
        },
    })
);

app.use("/api/tasks", tasksRoute);
app.use("/api/auth", authRoute);
app.use("/api/chat", chatRoute);

if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, '../frontend/dist')));

    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
    });
}

connectDB().then(() => {
    setupSocketServer(httpServer);

    httpServer.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
});


 