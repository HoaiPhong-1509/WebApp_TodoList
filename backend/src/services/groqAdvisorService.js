import OpenAI from "openai";

const DEFAULT_TIMEOUT_MS = process.env.NODE_ENV === "production" ? 12000 : 9000;
const MAX_TIMEOUT_MS = 60000;
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const toNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const getTimeoutMs = () => {
  const configured = toNumber(process.env.GROQ_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);

  if (configured <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }

  return Math.min(Math.max(configured, 1000), MAX_TIMEOUT_MS);
};

const getGroqConfig = () => {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_ADVISOR_MODEL || "llama-3.1-8b-instant";

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model,
  };
};

const stripCodeFence = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  if (!trimmed.startsWith("```") || !trimmed.endsWith("```")) {
    return trimmed;
  }

  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
};

const parseJsonSafely = (raw) => {
  try {
    return JSON.parse(stripCodeFence(raw));
  } catch {
    return null;
  }
};

const normalizeImpact = (value) => {
  const impact = String(value || "").toLowerCase();
  if (["high", "medium", "low"].includes(impact)) {
    return impact;
  }

  return "medium";
};

const clampLength = (value, max) => String(value || "").trim().slice(0, max);

const normalizeContextInstruction = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  return clampLength(value, 2600);
};

const normalizeRecommendations = (rawRecommendations) => {
  if (!Array.isArray(rawRecommendations)) {
    return [];
  }

  return rawRecommendations
    .map((item, index) => ({
      id: clampLength(item?.id || `groq-${index + 1}`, 48) || `groq-${index + 1}`,
      title: clampLength(item?.title || `Recommendation ${index + 1}`, 90),
      advice: clampLength(item?.advice || "", 420),
      reason: clampLength(item?.reason || "", 260),
      impact: normalizeImpact(item?.impact),
    }))
    .filter((item) => item.advice.length > 0)
    .slice(0, 4);
};

const buildGroqPrompt = ({ workspaceName, metrics, activitySeries, tasks }) => {
  const compactTasks = (tasks || [])
    .slice(0, 80)
    .map((task) => ({
      title: task?.title || "",
      status: task?.status || "todo",
      createdAt: task?.createdAt || null,
      completedAt: task?.completedAt || null,
    }));

  const compactActivity = (activitySeries || []).map((entry) => ({
    key: entry?.key,
    createdCount: entry?.createdCount || 0,
    completedCount: entry?.completedCount || 0,
    netFlow: entry?.netFlow || 0,
  }));

  return {
    workspaceName: workspaceName || "Default",
    metrics,
    activitySeries: compactActivity,
    tasks: compactTasks,
    instruction: {
      objective: "Tạo khuyến nghị năng suất dựa trên dữ liệu workflow task.",
      constraints: [
        "Chỉ sử dụng dữ liệu được cung cấp, không tự đặt thêm metric.",
        "Toàn bộ nội dung title/advice/reason phải viết bằng tiếng Việt có dấu đầy đủ.",
        "Khuyến nghị phải cụ thể, thực tế, có thể hành động ngay.",
        "Giữ giọng văn gọn, rõ, mang tính khoa học và hỗ trợ.",
      ],
      outputSchema: {
        recommendations: [
          {
            id: "string-short-id",
            title: "short title",
            advice: "actionable recommendation",
            reason: "brief scientific rationale",
            impact: "high|medium|low",
          },
        ],
      },
    },
  };
};

export const generateGroqTaskRecommendations = async ({ workspaceName, metrics, activitySeries, tasks }) => {
  const groqConfig = getGroqConfig();
  if (!groqConfig) {
    return null;
  }

  const timeoutMs = getTimeoutMs();
  const payload = buildGroqPrompt({ workspaceName, metrics, activitySeries, tasks });
  const client = new OpenAI({ apiKey: groqConfig.apiKey, baseURL: GROQ_BASE_URL });

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model: groqConfig.model,
        temperature: 0,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content:
              "Bạn là cố vấn work science. Bắt buộc trả về JSON hợp lệ duy nhất, không markdown, không thêm key ngoài schema, và nội dung recommendation phải bằng tiếng Việt có dấu đầy đủ.",
          },
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
      },
      {
        timeout: timeoutMs,
      }
    );
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "ETIMEDOUT") {
      const timeoutError = new Error(`Groq API timed out after ${timeoutMs}ms`);
      timeoutError.code = "GROQ_TIMEOUT";
      throw timeoutError;
    }

    const message = error?.error?.message || error?.message || "unknown error";
    const apiError = new Error(message);
    apiError.code = "GROQ_API_ERROR";
    apiError.status = error?.status;
    throw apiError;
  }

  const assistantContent = completion?.choices?.[0]?.message?.content;
  const modelJson = parseJsonSafely(assistantContent);
  const recommendations = normalizeRecommendations(modelJson?.recommendations);

  if (recommendations.length === 0) {
    const parseError = new Error("Groq returned no valid recommendations");
    parseError.code = "GROQ_INVALID_OUTPUT";
    throw parseError;
  }

  return {
    generatedAt: new Date().toISOString(),
    provider: "groq",
    model: groqConfig.model,
    metrics,
    recommendations,
  };
};

const normalizeAssistantHistory = (history = []) => {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .slice(-8)
    .map((entry) => {
      const role = entry?.role === "assistant" ? "assistant" : "user";
      const content = clampLength(entry?.content || "", 1200);

      if (!content) {
        return null;
      }

      return { role, content };
    })
    .filter(Boolean);
};

export const generateGroqAssistantReply = async ({ prompt, history = [], contextInstruction = "" }) => {
  const groqConfig = getGroqConfig();
  if (!groqConfig) {
    return null;
  }

  const safePrompt = clampLength(prompt || "", 1600);
  if (!safePrompt) {
    return null;
  }

  const timeoutMs = getTimeoutMs();
  const client = new OpenAI({ apiKey: groqConfig.apiKey, baseURL: GROQ_BASE_URL });

  const conversationHistory = normalizeAssistantHistory(history);
  const safeContextInstruction = normalizeContextInstruction(contextInstruction);
  const systemPrompt = [
    "Bạn là trợ lý tư vấn công việc cho ứng dụng Todo. Trả lời bằng tiếng Việt, ngắn gọn, có hành động cụ thể. Nếu thiếu dữ liệu thì nói rõ giả định và đề nghị người dùng bổ sung thông tin.",
    "Tuyệt đối không bịa tính năng, màn hình, API hay trường dữ liệu không có trong ngữ cảnh được cung cấp.",
    "Chỉ hướng dẫn thao tác đúng với UI/UX thực tế trong UI/UX SCHEMA nếu có. Nếu user hỏi thao tác không có trong schema này, trả lời: 'Tính năng này chưa có trên giao diện hiện tại.'",
    safeContextInstruction,
  ]
    .filter(Boolean)
    .join("\n\n");

  let completion;
  try {
    completion = await client.chat.completions.create(
      {
        model: groqConfig.model,
        temperature: 0.3,
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          ...conversationHistory,
          {
            role: "user",
            content: safePrompt,
          },
        ],
      },
      {
        timeout: timeoutMs,
      }
    );
  } catch (error) {
    if (error?.name === "AbortError" || error?.code === "ETIMEDOUT") {
      const timeoutError = new Error(`Groq API timed out after ${timeoutMs}ms`);
      timeoutError.code = "GROQ_TIMEOUT";
      throw timeoutError;
    }

    const message = error?.error?.message || error?.message || "unknown error";
    const apiError = new Error(message);
    apiError.code = "GROQ_API_ERROR";
    apiError.status = error?.status;
    throw apiError;
  }

  const reply = clampLength(completion?.choices?.[0]?.message?.content || "", 3200);
  if (!reply) {
    const parseError = new Error("Groq returned empty assistant reply");
    parseError.code = "GROQ_INVALID_OUTPUT";
    throw parseError;
  }

  return {
    provider: "groq",
    model: groqConfig.model,
    reply,
  };
};
