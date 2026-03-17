import mongoose from "mongoose";

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
});

workspaceSchema.index({ user: 1, normalizedName: 1 }, { unique: true });
workspaceSchema.index(
  { user: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } }
);

const Workspace = mongoose.model("Workspace", workspaceSchema);
export default Workspace;
