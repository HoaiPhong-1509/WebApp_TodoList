import Task from "../models/Task.js";

export const getAllTasks = async (req, res) => {
    const { filter = 'today' } = req.query;
    const now = new Date();
    let startDate;
    const userId = req.user._id;

    switch (filter) {
        case 'today':{
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        }
        case 'week': {
            const dayOfWeek = now.getDay();
            const diffFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffFromMonday);
            break;
        }
        case 'month': {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        }
        case 'all':
        default:{
            startDate = new Date(0);
        }
    };

    const query = {
        user: userId,
        ...(startDate ? { createdAt: { $gte: startDate } } : {}),
    };

    try {
        const result = await Task.aggregate([
            { $match: query },
            {
                $facet: {
                    tasks: [{$sort: { createdAt: -1 }}],
                    activeCount: [{$match: { status: "active" }}, {$count: "count" }],
                    completedCount: [{$match: { status: "completed" }}, {$count: "count" }]  
                }
            }
        ]);   
        
        const tasks = result[0].tasks;
        const activeCount = result[0].activeCount[0]?.count || 0;
        const completedCount = result[0].completedCount[0]?.count || 0;
        
        res.status(200).json({ tasks, activeCount, completedCount }); 
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ message: "Server error while fetching tasks" });
    }
};

export const createTask = async (req, res) => {
    try {
        const {title} = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ message: "Task title is required" });
        }

        const task = new Task({
            user: req.user._id,
            title: title.trim(),
        });

        const newTask = await task.save();
        res.status(201).json(newTask);
    }
    catch (error) {
        console.error("Error creating task:", error);
        res.status(500).json({ message: "Server error while creating task" });
    }
};

export const updateTask = async (req, res) => {
    try {
        const { title, status, completedAt } = req.body;
        const updates = {};

        if (typeof title === "string") {
            updates.title = title.trim();
        }

        if (typeof status === "string") {
            updates.status = status;
        }

        if (completedAt === null || typeof completedAt === "string") {
            updates.completedAt = completedAt;
        }

        const updateTask = await Task.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id },
            updates,
            { new : true}   
        );

        if (!updateTask) {
            return res.status(404).json({ message: "Task not found" });
        }
        res.status(200).json(updateTask);
    } catch (error) {
        console.error("Error updating task:", error);
        res.status(500).json({ message: "Server error while updating task" });
    }
};

export const deleteTask = async (req, res) => {
    try {
        const deleteTask = await Task.findOneAndDelete({ _id: req.params.id, user: req.user._id });

        if (!deleteTask) {
            return res.status(404).json({ message: "Task not found" });
        }
        res.status(200).json(deleteTask);
    } catch (error) {
        console.error("Error deleting task:", error);
        res.status(500).json({ message: "Server error while deleting task" });
    }
};