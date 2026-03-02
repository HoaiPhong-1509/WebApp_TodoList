import express from 'express';
import tasksRoute from './routes/tasksRouters.js';
import { connectDB } from './config/db.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 5001;

const app = express();

connectDB();

app.use("/api/tasks", tasksRoute);

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

