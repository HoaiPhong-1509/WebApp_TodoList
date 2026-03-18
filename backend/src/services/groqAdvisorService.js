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
