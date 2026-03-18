import User from "../models/User.js";
import { verifyAuthToken } from "../utils/auth.js";

const getBearerToken = (authorization) => {
  if (!authorization) {
    return null;
  }

  const [scheme, token] = authorization.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
};

export const requireAuth = async (req, res, next) => {
  try {
    const token = getBearerToken(req.headers.authorization);

    if (!token) {
      return res.status(401).json({ message: "Missing or invalid authorization token" });
    }

    const secret = process.env.JWT_SECRET || "dev_secret_change_me";
    const payload = verifyAuthToken(token, secret);
    const user = await User.findById(payload.userId).select("_id email name isVerified createdAt lastPasswordChangedAt");

    if (!user) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Authentication failed" });
  }
};
