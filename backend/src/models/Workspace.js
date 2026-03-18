import mongoose from "mongoose";

const workspaceMemberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["owner", "member"],
      default: "member",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const workspacePendingMemberSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const workspaceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    normalizedName: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 80,
      index: true,
    },
    isDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    lastAccessedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    inviteCode: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      minlength: 6,
      maxlength: 12,
    },
    members: {
      type: [workspaceMemberSchema],
      default: [],
    },
    pendingMembers: {
      type: [workspacePendingMemberSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

workspaceSchema.pre("validate", function normalizeName() {
  if (typeof this.name === "string") {
    this.name = this.name.trim();
    this.normalizedName = this.name.toLowerCase();
  }

  if (!this.user) {
    return;
  }

  const ownerId = this.user.toString();
  const sanitizedMembers = Array.isArray(this.members)
    ? this.members.filter((member) => member?.user)
    : [];

  const seen = new Set();
  const nextMembers = [];

  sanitizedMembers.forEach((member) => {
    const memberId = member.user.toString();
    if (seen.has(memberId)) {
      return;
    }

    seen.add(memberId);
    nextMembers.push({
      user: member.user,
      role: memberId === ownerId ? "owner" : member.role || "member",
      joinedAt: member.joinedAt || new Date(),
    });
  });

  if (!seen.has(ownerId)) {
    nextMembers.push({
      user: this.user,
      role: "owner",
      joinedAt: new Date(),
    });
    seen.add(ownerId);
  }

  this.members = nextMembers;

  const pendingSeen = new Set();
  this.pendingMembers = (Array.isArray(this.pendingMembers) ? this.pendingMembers : [])
    .filter((pending) => pending?.user)
    .filter((pending) => {
      const pendingId = pending.user.toString();
      if (pendingSeen.has(pendingId) || seen.has(pendingId)) {
        return false;
      }
      pendingSeen.add(pendingId);
      return true;
    });
});

workspaceSchema.index({ user: 1, normalizedName: 1 }, { unique: true });
workspaceSchema.index(
  { user: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);
workspaceSchema.index({ inviteCode: 1 }, { unique: true, sparse: true });
workspaceSchema.index({ "members.user": 1 });
workspaceSchema.index({ "pendingMembers.user": 1 });

const Workspace = mongoose.model("Workspace", workspaceSchema);
export default Workspace;
