import Task from "../models/Task.js";
import Workspace from "../models/Workspace.js";
import AiAdvisorCache from "../models/AiAdvisorCache.js";
import { ensureDefaultWorkspace } from "./workspacesControllers.js";
import { generateGroqTaskRecommendations } from "../services/groqAdvisorService.js";
import { getWorkspacePermissions, normalizeWorkspaceId } from "../utils/workspaceAccess.js";
import { logWorkspaceActivity } from "../utils/workspaceActivity.js";

const ACTIVITY_TIMEZONE = process.env.APP_TIMEZONE || "Asia/Ho_Chi_Minh";
const AI_SCOPE_LABEL = "Tat ca workspace";
const TASK_STATUS_LABELS = {
    todo: "To Do",
    in_progress: "In Progress",
    completed: "Completed",
};

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

    const workspace = await Workspace.findById(workspaceId);
    if (!workspace) {
        return null;
    }

    const permissions = getWorkspacePermissions(workspace, userId);
    if (!permissions.canAccess) {
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
            title: "Tạo dữ liệu nền trong 1 tuần",
            advice: "Hãy thêm ít nhất 5 task cụ thể trong tuần này và định nghĩa kết quả hoàn thành rõ ràng để AI phân tích chuẩn hơn.",
            reason: "Phân tích hành vi cần đủ dữ liệu sự kiện để tìm mẫu ổn định.",
            impact: "high",
        });
    } else {
        if (wipRatio > 40) {
            recommendations.push({
                id: "limit-wip",
                title: "Giới hạn task đang làm (WIP)",
                advice: `Bạn đang có ${inProgressCount} task đang làm (${wipRatio}%). Nên giới hạn WIP ở mức 2-3 task để giảm chi phí chuyển ngữ cảnh và tăng tốc độ hoàn thành.`,
                reason: "Nguyên tắc Kanban cho thấy WIP cao sẽ làm chu kỳ hoàn thành dài hơn và giảm năng suất.",
                impact: "high",
            });
        }

        if (completionRate < 45) {
            recommendations.push({
                id: "raise-completion",
                title: "Tăng nhịp độ hoàn thành",
                advice: `Tỉ lệ hoàn thành hiện là ${completionRate}%. Hãy áp dụng quy tắc Top-3 mỗi ngày và hoàn thành 1 task trước khi mở task mới.`,
                reason: "Mục tiêu nhỏ theo ngày giúp giảm mệt mỏi quyết định và giữ nhịp thực thi ổn định.",
                impact: "high",
            });
        }

        if (activityBalance < 0) {
            recommendations.push({
                id: "backlog-drift",
                title: "Kiểm soát tăng trưởng backlog",
                advice: `7 ngày gần nhất backlog tăng ròng (${activityCreated} tạo mới vs ${activityCompleted} hoàn thành). Nên dành 20 phút mỗi ngày để cắt tỉa backlog.`,
                reason: "Lượng việc vào không kiểm soát sẽ tăng tải nhận thức và làm giảm chất lượng làm việc sau đó.",
                impact: "medium",
            });
        }

        if (staleTodoCount > 0 || staleInProgressCount > 0) {
            recommendations.push({
                id: "stale-tasks",
                title: "Chia nhỏ task bị trễ",
                advice: `${staleTodoCount + staleInProgressCount} task đang bị trễ. Hãy tách mỗi task trễ thành bước hành động nhỏ nhất tiếp theo và định nghĩa điều kiện done rõ ràng.`,
                reason: "Kỹ thuật implementation intention giúp giảm trì hoãn và tăng tỷ lệ theo đến cùng.",
                impact: "high",
            });
        }

        const actionVerbRate = safeTasks.length > 0
            ? Math.round((actionFirstWordCount / safeTasks.length) * 100)
            : 0;

        if (actionVerbRate < 60 || vagueWordCount > 0 || avgTitleLength < 3) {
            recommendations.push({
                id: "task-clarity",
                title: "Nâng chất lượng đặt tên task",
                advice: `Chỉ ${actionVerbRate}% task bắt đầu bằng động từ hành động. Nên đặt tên theo dạng cụ thể, ví dụ "Viết nháp release notes" thay vì nhãn mơ hồ.`,
                reason: "Cách đặt tên rõ ràng, hướng hành động sẽ tăng độ chính xác khi lập kế hoạch và khả năng hoàn thành.",
                impact: "medium",
            });
        }

        recommendations.push({
            id: "topic-batching",
            title: "Gom việc theo chủ đề",
            advice: `Nhóm công việc chiếm ưu thế hiện tại là ${dominantTopic}. Hãy gom các task cùng loại thành block tập trung 60-90 phút để giảm chi phí chuyển đổi.`,
            reason: "Nghiên cứu nhận thức cho thấy dư âm chú ý giảm khi gom việc tương đồng.",
            impact: "medium",
        });
    }

    if (recommendations.length === 0) {
        recommendations.push({
            id: "keep-rhythm",
            title: "Duy trì nhịp hiện tại",
            advice: "Các chỉ số workflow đang ổn định. Hãy giữ review hằng tuần và kỷ luật WIP để bảo toàn đà tăng.",
            reason: "Hệ thống ổn định thường đạt hiệu quả cao với vòng lặp review gọn nhẹ và đều đặn.",
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

        const workspacePermissions = getWorkspacePermissions(workspace, userId);
        if (!workspacePermissions.canCrudTasks) {
            return res.status(403).json({ message: "You do not have access to this workspace" });
        }

        const accessibleWorkspaceIds = await Workspace.find({
            $or: [{ user: userId }, { "members.user": userId }],
        }).distinct("_id");

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
                { $match: { workspace: { $in: accessibleWorkspaceIds } } },
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
                        workspace: { $in: accessibleWorkspaceIds },
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
                        workspace: { $in: accessibleWorkspaceIds },
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
            Task.find({ workspace: { $in: accessibleWorkspaceIds } }).sort({ createdAt: -1 }).limit(240).lean(),
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

        const hasUsableGroqCache = cachedAdvisorDoc?.advisor?.provider === "groq";

        let aiAdvisor = hasUsableGroqCache
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

        if (!hasUsableGroqCache) {
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
                    hit: hasUsableGroqCache,
                },
            };

            if (aiAdvisor.provider === "groq") {
                await saveCachedAiAdvisor(userId, advisorDateKey, aiAdvisor);
            }
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
                permissions: workspacePermissions,
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

        const workspacePermissions = getWorkspacePermissions(workspace, req.user._id);
        if (!workspacePermissions.canCrudTasks) {
            return res.status(403).json({ message: "You do not have access to this workspace" });
        }

        await migrateLegacyTasksToWorkspace(req.user._id, workspace._id);

        const task = new Task({
            user: req.user._id,
            workspace: workspace._id,
            title: title.trim(),
        });

        const newTask = await task.save();
        await touchWorkspaceAccess(workspace._id);
        await logWorkspaceActivity({
            workspaceId: workspace._id,
            actor: req.user,
            type: "task_created",
            message: `${req.user.name || req.user.email} created task \"${newTask.title}\"`,
            metadata: {
                taskId: newTask._id,
                taskTitle: newTask.title,
            },
        });
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

        const workspacePermissions = getWorkspacePermissions(workspace, req.user._id);
        if (!workspacePermissions.canCrudTasks) {
            return res.status(403).json({ message: "You do not have access to this workspace" });
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

        const existingTask = await Task.findOne({ _id: req.params.id, workspace: workspace._id });
        if (!existingTask) {
            return res.status(404).json({ message: "Task not found" });
        }

        const previousTitle = existingTask.title;
        const previousStatus = existingTask.status;

        Object.assign(existingTask, updates);
        const updateTask = await existingTask.save();

        const changes = [];
        if (typeof updates.title === "string" && updates.title !== previousTitle) {
            changes.push("title");
        }
        if (typeof updates.status === "string" && updates.status !== previousStatus) {
            changes.push("status");
        }

        const actorLabel = req.user.name || req.user.email;
        let activityMessage = `${actorLabel} updated task \"${updateTask.title}\"`;

        if (changes.includes("title") && changes.includes("status")) {
            activityMessage = `${actorLabel} renamed task from \"${previousTitle}\" to \"${updateTask.title}\" and changed status from ${TASK_STATUS_LABELS[previousStatus] || previousStatus} to ${TASK_STATUS_LABELS[updateTask.status] || updateTask.status}`;
        } else if (changes.includes("status")) {
            activityMessage = `${actorLabel} changed \"${updateTask.title}\" from ${TASK_STATUS_LABELS[previousStatus] || previousStatus} to ${TASK_STATUS_LABELS[updateTask.status] || updateTask.status}`;
        } else if (changes.includes("title")) {
            activityMessage = `${actorLabel} renamed task from \"${previousTitle}\" to \"${updateTask.title}\"`;
        }

        await touchWorkspaceAccess(workspace._id);
        await logWorkspaceActivity({
            workspaceId: workspace._id,
            actor: req.user,
            type: "task_updated",
            message: activityMessage,
            metadata: {
                taskId: updateTask._id,
                taskTitle: updateTask.title,
                previousTitle,
                previousStatus,
                nextStatus: updateTask.status,
                changes,
            },
        });
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

        const workspacePermissions = getWorkspacePermissions(workspace, req.user._id);
        if (!workspacePermissions.canCrudTasks) {
            return res.status(403).json({ message: "You do not have access to this workspace" });
        }

        await migrateLegacyTasksToWorkspace(req.user._id, workspace._id);

        const deleteTask = await Task.findOneAndDelete({ _id: req.params.id, workspace: workspace._id });

        if (!deleteTask) {
            return res.status(404).json({ message: "Task not found" });
        }
        await touchWorkspaceAccess(workspace._id);
        await logWorkspaceActivity({
            workspaceId: workspace._id,
            actor: req.user,
            type: "task_deleted",
            message: `${req.user.name || req.user.email} deleted task \"${deleteTask.title}\"`,
            metadata: {
                taskId: deleteTask._id,
                taskTitle: deleteTask.title,
            },
        });
        res.status(200).json(deleteTask);
    } catch (error) {
        console.error("Error deleting task:", error);
        res.status(500).json({ message: "Server error while deleting task" });
    }
};