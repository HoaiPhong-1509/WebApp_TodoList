import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        workspace: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Workspace",
            default: null,
            index: true,
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        status: {
            type: String,
            enum: ["todo", "in_progress", "completed"],
            default: "todo"
        },
        completedAt: {
            type: Date,
            default: null
        },
    },
    {
        timestamps: true,
    }
);

taskSchema.index({ user: 1, workspace: 1, createdAt: -1 });

const Task = mongoose.model("Task", taskSchema);
export default Task;