import Task from "../models/Task.js";
import Workspace from "../models/Workspace.js";
import { ensureDefaultWorkspace } from "./workspacesControllers.js";

const ACTIVITY_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Ho_Chi_Minh";

const formatDateKeyInTimezone = (date, timeZone = ACTIVITY_TIMEZONE) => {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);

    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;

    return `${year}-${month}-${day}`;
};

const normalizeWorkspaceId = (rawId) => {
    if (!rawId || typeof rawId !== "string") {
        return null;
    }
    const trimmed = rawId.trim();
    return trimmed || null;
};

const resolveWorkspaceForRequest = async (userId, rawWorkspaceId) => {
    const defaultWorkspace = await ensureDefaultWorkspace(userId);
    const workspaceId = normalizeWorkspaceId(rawWorkspaceId);

    if (!workspaceId) {
        return defaultWorkspace;
    }

    const workspace = await Workspace.findOne({ _id: workspaceId, user: userId });
    if (!workspace) {
        return null;
    }

    return workspace;
};

const migrateLegacyTasksToWorkspace = async (userId, workspaceId) => {
    await Task.updateMany(
        { user: userId, workspace: { $in: [null, undefined] } },
        { $set: { workspace: workspaceId } }
    );
};

const touchWorkspaceAccess = async (workspaceId) => {
    await Workspace.updateOne({ _id: workspaceId }, { $set: { lastAccessedAt: new Date() } });
};

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
        ...(startDate ? { createdAt: { $gte: startDate } } : {})
    };
    const activityStartDate = new Date(now);
    activityStartDate.setUTCHours(0, 0, 0, 0);
    activityStartDate.setUTCDate(activityStartDate.getUTCDate() - 6);

    try {
        const workspace = await resolveWorkspaceForRequest(userId, req.query.workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        await migrateLegacyTasksToWorkspace(userId, workspace._id);
        query.workspace = workspace._id;

        const [workspaceResult, userSummaryResult, activityCreatedResult, activityCompletedResult] = await Promise.all([
            Task.aggregate([
                { $match: query },
                {
                    $facet: {
                        tasks: [{$sort: { createdAt: -1 }}],
                        todoCount: [{$match: { status: { $in: ["todo", "active"] } }}, {$count: "count" }],
                        inProgressCount: [{$match: { status: "in_progress" }}, {$count: "count" }],
                        completedCount: [{$match: { status: "completed" }}, {$count: "count" }]  
                    }
                }
            ]),
            Task.aggregate([
                {
                    $match: {
                        user: userId,
                    },
                },
                {
                    $facet: {
                        todoCount: [{$match: { status: { $in: ["todo", "active"] } }}, {$count: "count" }],
                        inProgressCount: [{$match: { status: "in_progress" }}, {$count: "count" }],
                        completedCount: [{$match: { status: "completed" }}, {$count: "count" }],
                    },
                },
            ]),
            Task.aggregate([
                {
                    $match: {
                        user: userId,
                        workspace: workspace._id,
                        createdAt: { $gte: activityStartDate },
                    },
                },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: "%Y-%m-%d",
                                date: "$createdAt",
                                timezone: ACTIVITY_TIMEZONE,
                            },
                        },
                        count: { $sum: 1 },
                    },
                },
            ]),
            Task.aggregate([
                {
                    $match: {
                        user: userId,
                        workspace: workspace._id,
                        completedAt: {
                            $ne: null,
                            $gte: activityStartDate,
                        },
                    },
                },
                {
                    $group: {
                        _id: {
                            $dateToString: {
                                format: "%Y-%m-%d",
                                date: "$completedAt",
                                timezone: ACTIVITY_TIMEZONE,
                            },
                        },
                        count: { $sum: 1 },
                    },
                },
            ]),
        ]);
        
        const tasks = workspaceResult[0].tasks.map((task) => ({
            ...task,
            status: task.status === "active" ? "todo" : task.status,
        }));
        const todoCount = workspaceResult[0].todoCount[0]?.count || 0;
        const inProgressCount = workspaceResult[0].inProgressCount[0]?.count || 0;
        const completedCount = workspaceResult[0].completedCount[0]?.count || 0;
        const userTodoCount = userSummaryResult[0].todoCount[0]?.count || 0;
        const userInProgressCount = userSummaryResult[0].inProgressCount[0]?.count || 0;
        const userCompletedCount = userSummaryResult[0].completedCount[0]?.count || 0;
        const createdByDate = new Map(activityCreatedResult.map((item) => [item._id, item.count]));
        const completedByDate = new Map(activityCompletedResult.map((item) => [item._id, item.count]));
        const userActivitySeries = [];

        for (let i = 6; i >= 0; i -= 1) {
            const day = new Date(now);
            day.setDate(day.getDate() - i);

            const key = formatDateKeyInTimezone(day);
            const createdCount = createdByDate.get(key) || 0;
            const completedCount = completedByDate.get(key) || 0;

            userActivitySeries.push({
                key,
                label: day.toLocaleDateString("en-US", { weekday: "short", timeZone: ACTIVITY_TIMEZONE }),
                createdCount,
                completedCount,
                netFlow: completedCount - createdCount,
            });
        }

        await touchWorkspaceAccess(workspace._id);
        
        res.status(200).json({
            tasks,
            todoCount,
            inProgressCount,
            completedCount,
            userSummary: {
                todoCount: userTodoCount,
                inProgressCount: userInProgressCount,
                completedCount: userCompletedCount,
                totalCount: userTodoCount + userInProgressCount + userCompletedCount,
            },
            userActivitySeries,
            workspace: {
                id: workspace._id,
                name: workspace.name,
            },
        }); 
    } catch (error) {
        console.error("Error fetching tasks:", error);
        res.status(500).json({ message: "Server error while fetching tasks" });
    }
};

export const createTask = async (req, res) => {
    try {
        const {title, workspaceId} = req.body;

        if (!title || !title.trim()) {
            return res.status(400).json({ message: "Task title is required" });
        }

        const workspace = await resolveWorkspaceForRequest(req.user._id, workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        await migrateLegacyTasksToWorkspace(req.user._id, workspace._id);

        const task = new Task({
            user: req.user._id,
            workspace: workspace._id,
            title: title.trim(),
        });

        const newTask = await task.save();
        await touchWorkspaceAccess(workspace._id);
        res.status(201).json(newTask);
    }
    catch (error) {
        console.error("Error creating task:", error);
        res.status(500).json({ message: "Server error while creating task" });
    }
};

export const updateTask = async (req, res) => {
    try {
        const { title, status, completedAt, workspaceId } = req.body;
        const updates = {};
        let normalizedStatus;

        const workspace = await resolveWorkspaceForRequest(req.user._id, workspaceId || req.query.workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        await migrateLegacyTasksToWorkspace(req.user._id, workspace._id);

        if (typeof title === "string") {
            updates.title = title.trim();
        }

        if (typeof status === "string") {
            normalizedStatus = status === "active" ? "todo" : status;

            if (!["todo", "in_progress", "completed"].includes(normalizedStatus)) {
                return res.status(400).json({ message: "Invalid task status" });
            }

            updates.status = normalizedStatus;

            if (normalizedStatus === "completed") {
                updates.completedAt = typeof completedAt === "string" ? completedAt : new Date().toISOString();
            } else {
                updates.completedAt = null;
            }
        }

        if (normalizedStatus === undefined && (completedAt === null || typeof completedAt === "string")) {
            updates.completedAt = completedAt;
        }

        const updateTask = await Task.findOneAndUpdate(
            { _id: req.params.id, user: req.user._id, workspace: workspace._id },
            updates,
            { new : true, runValidators: true }   
        );

        if (!updateTask) {
            return res.status(404).json({ message: "Task not found" });
        }
        await touchWorkspaceAccess(workspace._id);
        res.status(200).json(updateTask);
    } catch (error) {
        console.error("Error updating task:", error);
        res.status(500).json({ message: "Server error while updating task" });
    }
};

export const deleteTask = async (req, res) => {
    try {
        const workspace = await resolveWorkspaceForRequest(req.user._id, req.query.workspaceId);
        if (!workspace) {
            return res.status(404).json({ message: "Workspace not found" });
        }

        await migrateLegacyTasksToWorkspace(req.user._id, workspace._id);

        const deleteTask = await Task.findOneAndDelete({ _id: req.params.id, user: req.user._id, workspace: workspace._id });

        if (!deleteTask) {
            return res.status(404).json({ message: "Task not found" });
        }
        await touchWorkspaceAccess(workspace._id);
        res.status(200).json(deleteTask);
    } catch (error) {
        console.error("Error deleting task:", error);
        res.status(500).json({ message: "Server error while deleting task" });
    }
};