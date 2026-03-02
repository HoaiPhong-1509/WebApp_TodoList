import Task from "../models/Task.js";

export const getAllTasks = async (req, res) => {
    try {
        const tasks = await Task.find();
        res.status(200).json(tasks);
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ message: "Server error while fetching tasks" });
    }
};

export const createTask = (req, res) => {
    res.status(201).json({ message: "Task created successfully!" });
};

export const updateTask = (req, res) => {
    res.status(200).json({ message: "Task updated successfully!" });
};

export const deleteTask = (req, res) => {
    res.status(200).json({ message: "Task deleted successfully!" });
};