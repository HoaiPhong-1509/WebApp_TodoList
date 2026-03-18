import Task from "../models/Task.js";
import Workspace from "../models/Workspace.js";
import AiAdvisorCache from "../models/AiAdvisorCache.js";
import { ensureDefaultWorkspace } from "./workspacesControllers.js";
import { generateGroqTaskRecommendations } from "../services/groqAdvisorService.js";

const ACTIVITY_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Ho_Chi_Minh";
const AI_SCOPE_LABEL = "Tat ca workspace";

const ACTION_VERBS = new Set([
    "analyze",
    "build",
    "calculate",
    "clean",
    "create",
    "debug",
    "deploy",
    "design",
    "document",
    "draft",
    "fix",
    "implement",
    "improve",
    "investigate",
    "optimize",
    "plan",
    "prepare",
    "refactor",
    "review",
    "ship",
    "summarize",
    "test",
    "update",
    "validate",
    "write",
]);

const VAGUE_WORDS = new Set([
    "misc",
    "other",
    "something",
    "stuff",
    "thing",
    "things",
    "tmp",
]);

const TOPIC_MAP = {
    Coding: ["api", "backend", "frontend", "bug", "code", "component", "database", "deploy", "feature", "fix", "refactor", "server", "ui", "ux"],
    Learning: ["course", "learn", "read", "research", "study", "tutorial"],
    Documentation: ["doc", "docs", "document", "note", "report", "summary", "write"],
    Planning: ["estimate", "goal", "plan", "roadmap", "strategy"],
    Operations: ["audit", "backup", "monitor", "ops", "security", "support"],
    Communication: ["call", "chat", "email", "meeting", "message", "sync"],
};

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

const getAdvisorDateKey = (date = new Date()) => formatDateKeyInTimezone(date);

const getCacheExpiryDate = (date = new Date()) => {
    const expiresAt = new Date(date);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 8);
    return expiresAt;
};

const getCachedAiAdvisor = async (userId, dateKey) => {
    return AiAdvisorCache.findOne({ user: userId, dateKey }).select("advisor").lean();
};

const saveCachedAiAdvisor = async (userId, dateKey, advisor) => {
    await AiAdvisorCache.updateOne(
        { user: userId, dateKey },
        {
            $set: {
                advisor,
                expiresAt: getCacheExpiryDate(),
            },
        },
        { upsert: true }
    );
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

const tokenizeTitle = (title) =>
    String(title || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter(Boolean);

const classifyTaskTopic = (title) => {
    const tokens = tokenizeTitle(title);
    let bestTopic = "General";
    let bestScore = 0;

    Object.entries(TOPIC_MAP).forEach(([topic, keywords]) => {
        const score = keywords.reduce((sum, keyword) => {
            return sum + (tokens.includes(keyword) ? 1 : 0);
        }, 0);

        if (score > bestScore) {
            bestTopic = topic;
            bestScore = score;
        }
    });

    return bestScore > 0 ? bestTopic : "General";
};

const buildScientificRecommendations = ({ tasks, todoCount, inProgressCount, completedCount, activitySeries }) => {
    const safeTasks = Array.isArray(tasks) ? tasks : [];
    const totalCount = todoCount + inProgressCount + completedCount;
    const nowMs = Date.now();

    const staleTodoCount = safeTasks.filter((task) => {
        if (task?.status !== "todo" || !task?.createdAt) {
            return false;
        }
        const ageHours = (nowMs - new Date(task.createdAt).getTime()) / (1000 * 60 * 60);
        return ageHours >= 72;
    }).length;

    const staleInProgressCount = safeTasks.filter((task) => {
        if (task?.status !== "in_progress" || !task?.createdAt) {
            return false;
        }
        const ageHours = (nowMs - new Date(task.createdAt).getTime()) / (1000 * 60 * 60);
        return ageHours >= 48;
    }).length;

    const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
    const wipRatio = totalCount > 0 ? Math.round((inProgressCount / totalCount) * 100) : 0;

    const activityCreated = (activitySeries || []).reduce((sum, day) => sum + (day.createdCount || 0), 0);
    const activityCompleted = (activitySeries || []).reduce((sum, day) => sum + (day.completedCount || 0), 0);
    const activityBalance = activityCompleted - activityCreated;

    const titleTokens = safeTasks.flatMap((task) => tokenizeTitle(task?.title));
    const uniqueTokens = new Set(titleTokens);
    const actionFirstWordCount = safeTasks.reduce((sum, task) => {
        const [firstWord] = tokenizeTitle(task?.title);
        return sum + (firstWord && ACTION_VERBS.has(firstWord) ? 1 : 0);
    }, 0);
    const vagueWordCount = titleTokens.reduce((sum, token) => sum + (VAGUE_WORDS.has(token) ? 1 : 0), 0);
    const avgTitleLength = safeTasks.length > 0
        ? Math.round(
            safeTasks.reduce((sum, task) => sum + tokenizeTitle(task?.title).length, 0) /
            safeTasks.length
        )
        : 0;

    const topicCounter = safeTasks.reduce((acc, task) => {
        const topic = classifyTaskTopic(task?.title);
        acc[topic] = (acc[topic] || 0) + 1;
        return acc;
    }, {});

    const dominantTopic = Object.entries(topicCounter)
        .sort((a, b) => b[1] - a[1])[0]?.[0] || "General";

    const recommendations = [];

    if (totalCount === 0) {
        recommendations.push({
            id: "seed-data",
            title: "Tao du lieu nen trong 1 tuan",
            advice: "Hay them it nhat 5 task cu the trong tuan nay va dinh nghia ket qua hoan thanh ro rang de AI phan tich chuan hon.",
            reason: "Phan tich hanh vi can du du lieu su kien de tim mau on dinh.",
            impact: "high",
        });
    } else {
        if (wipRatio > 40) {
            recommendations.push({
                id: "limit-wip",
                title: "Gioi han task dang lam (WIP)",
                advice: `Ban dang co ${inProgressCount} task dang lam (${wipRatio}%). Nen gioi han WIP o muc 2-3 task de giam chi phi chuyen ngu canh va tang toc do hoan thanh.`,
                reason: "Nguyen tac Kanban cho thay WIP cao se lam chu ky hoan thanh dai hon va giam nang suat.",
                impact: "high",
            });
        }

        if (completionRate < 45) {
            recommendations.push({
                id: "raise-completion",
                title: "Tang nhip do hoan thanh",
                advice: `Ti le hoan thanh hien la ${completionRate}%. Hay ap dung quy tac Top-3 moi ngay va hoan thanh 1 task truoc khi mo task moi.`,
                reason: "Muc tieu nho theo ngay giup giam met moi quyet dinh va giu nhip thuc thi on dinh.",
                impact: "high",
            });
        }

        if (activityBalance < 0) {
            recommendations.push({
                id: "backlog-drift",
                title: "Kiem soat tang truong backlog",
                advice: `7 ngay gan nhat backlog tang rong (${activityCreated} tao moi vs ${activityCompleted} hoan thanh). Nen dat 20 phut moi ngay de cat tia backlog.`,
                reason: "Luong viec vao khong kiem soat se tang tai nhan thuc va lam giam chat luong lam viec sau.",
                impact: "medium",
            });
        }

        if (staleTodoCount > 0 || staleInProgressCount > 0) {
            recommendations.push({
                id: "stale-tasks",
                title: "Chia nho task bi tre",
                advice: `${staleTodoCount + staleInProgressCount} task dang bi tre. Hay tach moi task tre thanh buoc hanh dong nho nhat tiep theo va dinh nghia dieu kien done ro rang.`,
                reason: "Ky thuat implementation intention giup giam tri hoan va tang ty le theo den cung.",
                impact: "high",
            });
        }

        const actionVerbRate = safeTasks.length > 0
            ? Math.round((actionFirstWordCount / safeTasks.length) * 100)
            : 0;

        if (actionVerbRate < 60 || vagueWordCount > 0 || avgTitleLength < 3) {
            recommendations.push({
                id: "task-clarity",
                title: "Nang chat luong dat ten task",
                advice: `Chi ${actionVerbRate}% task bat dau bang dong tu hanh dong. Nen dat ten theo dang cu the, vi du "Viet nhap release notes" thay vi nhan mo ho.`,
                reason: "Cach dat ten ro rang, huong hanh dong se tang do chinh xac khi lap ke hoach va kha nang hoan thanh.",
                impact: "medium",
            });
        }

        recommendations.push({
            id: "topic-batching",
            title: "Gom viec theo chu de",
            advice: `Nhom cong viec chiem uu the hien tai la ${dominantTopic}. Hay gom cac task cung loai thanh block tap trung 60-90 phut de giam chi phi chuyen doi.`,
            reason: "Nghien cuu nhan thuc cho thay du am chu y giam khi gom viec tuong dong.",
            impact: "medium",
        });
    }

    if (recommendations.length === 0) {
        recommendations.push({
            id: "keep-rhythm",
            title: "Duy tri nhip hien tai",
            advice: "Cac chi so workflow dang on dinh. Hay giu review hang tuan va ky luat WIP de bao toan da tang.",
            reason: "He thong on dinh thuong dat hieu qua cao voi vong lap review gon nhe va deu dan.",
            impact: "low",
        });
    }

    return {
        generatedAt: new Date().toISOString(),
        metrics: {
            totalCount,
            completionRate,
            wipRatio,
            staleTodoCount,
            staleInProgressCount,
            titleVocabularySize: uniqueTokens.size,
            averageTitleLengthWords: avgTitleLength,
            activityCreated,
            activityCompleted,
            activityBalance,
            dominantTopic,
        },
        recommendations: recommendations.slice(0, 4),
        scope: "all_workspaces",
    };
};

export const getAllTasks = async (req, res) => {
    const { filter = "today" } = req.query;
    const now = new Date();
    let startDate;
    const userId = req.user._id;

    switch (filter) {
        case "today": {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
        }
        case "week": {
            const dayOfWeek = now.getDay();
            const diffFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diffFromMonday);
            break;
        }
        case "month": {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
        }
        case "all":
        default: {
            startDate = new Date(0);
        }
    }

    const query = {
        user: userId,
        ...(startDate ? { createdAt: { $gte: startDate } } : {}),
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

        const [workspaceResult, userSummaryResult, activityCreatedResult, activityCompletedResult, globalActivityCreatedResult, globalActivityCompletedResult, aiTasksRaw] = await Promise.all([
            Task.aggregate([
                { $match: query },
                {
                    $facet: {
                        tasks: [{ $sort: { createdAt: -1 } }],
                        todoCount: [{ $match: { status: { $in: ["todo", "active"] } } }, { $count: "count" }],
                        inProgressCount: [{ $match: { status: "in_progress" } }, { $count: "count" }],
                        completedCount: [{ $match: { status: "completed" } }, { $count: "count" }],
                    },
                },
            ]),
            Task.aggregate([
                { $match: { user: userId } },
                {
                    $facet: {
                        todoCount: [{ $match: { status: { $in: ["todo", "active"] } } }, { $count: "count" }],
                        inProgressCount: [{ $match: { status: "in_progress" } }, { $count: "count" }],
                        completedCount: [{ $match: { status: "completed" } }, { $count: "count" }],
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
            Task.aggregate([
                {
                    $match: {
                        user: userId,
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
            Task.find({ user: userId }).sort({ createdAt: -1 }).limit(240).lean(),
        ]);

        const tasks = workspaceResult[0].tasks.map((task) => ({
            ...task,
            status: task.status === "active" ? "todo" : task.status,
        }));

        const aiTasks = aiTasksRaw.map((task) => ({
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
        const globalCreatedByDate = new Map(globalActivityCreatedResult.map((item) => [item._id, item.count]));
        const globalCompletedByDate = new Map(globalActivityCompletedResult.map((item) => [item._id, item.count]));

        const userActivitySeries = [];
        const aiActivitySeries = [];

        for (let i = 6; i >= 0; i -= 1) {
            const day = new Date(now);
            day.setDate(day.getDate() - i);

            const key = formatDateKeyInTimezone(day);
            const createdCount = createdByDate.get(key) || 0;
            const completedCount = completedByDate.get(key) || 0;
            const globalCreatedCount = globalCreatedByDate.get(key) || 0;
            const globalCompletedCount = globalCompletedByDate.get(key) || 0;

            userActivitySeries.push({
                key,
                label: day.toLocaleDateString("en-US", { weekday: "short", timeZone: ACTIVITY_TIMEZONE }),
                createdCount,
                completedCount,
                netFlow: completedCount - createdCount,
            });

            aiActivitySeries.push({
                key,
                label: day.toLocaleDateString("en-US", { weekday: "short", timeZone: ACTIVITY_TIMEZONE }),
                createdCount: globalCreatedCount,
                completedCount: globalCompletedCount,
                netFlow: globalCompletedCount - globalCreatedCount,
            });
        }

        const fallbackAiAdvisor = buildScientificRecommendations({
            tasks: aiTasks,
            todoCount: userTodoCount,
            inProgressCount: userInProgressCount,
            completedCount: userCompletedCount,
            activitySeries: aiActivitySeries,
        });

        const advisorDateKey = getAdvisorDateKey(now);
        const cachedAdvisorDoc = await getCachedAiAdvisor(userId, advisorDateKey);

        let aiAdvisor = cachedAdvisorDoc?.advisor
            ? {
                ...cachedAdvisorDoc.advisor,
                scope: "all_workspaces",
                cache: {
                    by: "user_day",
                    dateKey: advisorDateKey,
                    hit: true,
                },
            }
            : {
                ...fallbackAiAdvisor,
                provider: "rule-based",
                fallbackUsed: true,
                scope: "all_workspaces",
            };

        if (!cachedAdvisorDoc?.advisor) {
            try {
                const groqAdvisor = await generateGroqTaskRecommendations({
                    workspaceName: AI_SCOPE_LABEL,
                    metrics: fallbackAiAdvisor.metrics,
                    activitySeries: aiActivitySeries,
                    tasks: aiTasks,
                });

                if (groqAdvisor) {
                    aiAdvisor = {
                        ...groqAdvisor,
                        fallbackUsed: false,
                        scope: "all_workspaces",
                    };
                }
            } catch (advisorError) {
                console.warn("Groq advisor failed, using fallback:", {
                    code: advisorError?.code,
                    message: advisorError?.message,
                });
            }

            aiAdvisor = {
                ...aiAdvisor,
                cache: {
                    by: "user_day",
                    dateKey: advisorDateKey,
                    hit: false,
                },
            };

            await saveCachedAiAdvisor(userId, advisorDateKey, aiAdvisor);
        }

        await touchWorkspaceAccess(workspace._id);

        return res.status(200).json({
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
            aiAdvisor,
            workspace: {
                id: workspace._id,
                name: workspace.name,
            },
        });
    } catch (error) {
        console.error("Error fetching tasks:", error);
        return res.status(500).json({ message: "Server error while fetching tasks" });
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