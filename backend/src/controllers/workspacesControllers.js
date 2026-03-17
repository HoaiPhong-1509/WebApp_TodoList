import Workspace from "../models/Workspace.js";

const normalize = (value = "") => String(value).trim().toLowerCase();

const scoreWorkspace = (normalizedName, normalizedQuery) => {
  if (!normalizedQuery) {
    return 0;
  }

  if (normalizedName === normalizedQuery) {
    return 1000;
  }

  if (normalizedName.startsWith(normalizedQuery)) {
    return 700;
  }

  const idx = normalizedName.indexOf(normalizedQuery);
  if (idx >= 0) {
    return 500 - idx;
  }

  let overlap = 0;
  for (const ch of normalizedQuery) {
    if (normalizedName.includes(ch)) {
      overlap += 1;
    }
  }

  return overlap;
};

export const ensureDefaultWorkspace = async (userId) => {
  const existing = await Workspace.findOne({ user: userId, isDefault: true });
  if (existing) {
    return existing;
  }

  try {
    return await Workspace.create({
      user: userId,
      name: "My Workspace",
      normalizedName: "my workspace",
      isDefault: true,
      lastAccessedAt: new Date(),
    });
  } catch (error) {
    if (error?.code === 11000) {
      return Workspace.findOne({ user: userId, isDefault: true });
    }
    throw error;
  }
};

export const listWorkspaces = async (req, res) => {
  try {
    const userId = req.user._id;
    const q = normalize(req.query.q || "");

    await ensureDefaultWorkspace(userId);

    const workspaces = await Workspace.find({ user: userId })
      .select("_id name isDefault lastAccessedAt updatedAt createdAt")
      .lean();

    const ranked = workspaces
      .map((workspace) => ({
        ...workspace,
        relevance: scoreWorkspace(normalize(workspace.name), q),
      }))
      .filter((workspace) => (q ? workspace.relevance > 0 : true))
      .sort((a, b) => {
        if (b.relevance !== a.relevance) return b.relevance - a.relevance;
        return new Date(b.lastAccessedAt || b.updatedAt || b.createdAt) - new Date(a.lastAccessedAt || a.updatedAt || a.createdAt);
      })
      .map(({ relevance, ...workspace }) => workspace);

    return res.status(200).json({ workspaces: ranked });
  } catch (error) {
    console.error("Error listing workspaces:", error);
    return res.status(500).json({ message: "Server error while listing workspaces" });
  }
};

export const createWorkspace = async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      return res.status(400).json({ message: "Workspace name is required" });
    }

    const userId = req.user._id;
    await ensureDefaultWorkspace(userId);

    const workspace = await Workspace.create({
      user: userId,
      name,
      normalizedName: name.toLowerCase(),
      isDefault: false,
      lastAccessedAt: new Date(),
    });

    return res.status(201).json({ workspace });
  } catch (error) {
    if (error?.code === 11000) {
      return res.status(409).json({ message: "Workspace name already exists" });
    }

    console.error("Error creating workspace:", error);
    return res.status(500).json({ message: "Server error while creating workspace" });
  }
};

export const activateWorkspace = async (req, res) => {
  try {
    const workspace = await Workspace.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: { lastAccessedAt: new Date() } },
      { new: true }
    ).select("_id name isDefault lastAccessedAt updatedAt");

    if (!workspace) {
      return res.status(404).json({ message: "Workspace not found" });
    }

    return res.status(200).json({ workspace });
  } catch (error) {
    console.error("Error activating workspace:", error);
    return res.status(500).json({ message: "Server error while activating workspace" });
  }
};
