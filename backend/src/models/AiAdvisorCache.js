import mongoose from "mongoose";

const aiAdvisorCacheSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
            index: true,
        },
        dateKey: {
            type: String,
            required: true,
            trim: true,
        },
        advisor: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        expiresAt: {
            type: Date,
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

aiAdvisorCacheSchema.index({ user: 1, dateKey: 1 }, { unique: true });
aiAdvisorCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const AiAdvisorCache = mongoose.model("AiAdvisorCache", aiAdvisorCacheSchema);

export default AiAdvisorCache;