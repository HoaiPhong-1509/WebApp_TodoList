import crypto from "crypto";

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7;

const toBase64Url = (value) => Buffer.from(value, "utf8").toString("base64url");
const fromBase64Url = (value) => Buffer.from(value, "base64url").toString("utf8");

export const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
};

export const verifyPassword = (password, storedPassword) => {
  const [salt, savedHash] = storedPassword.split(":");

  if (!salt || !savedHash) {
    return false;
  }

  const hashBuffer = crypto.scryptSync(password, salt, 64);
  const savedHashBuffer = Buffer.from(savedHash, "hex");

  if (hashBuffer.length !== savedHashBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(hashBuffer, savedHashBuffer);
};

export const createAuthToken = (payload, secret) => {
  const tokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };

  const encodedPayload = toBase64Url(JSON.stringify(tokenPayload));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  return `${encodedPayload}.${signature}`;
};

export const verifyAuthToken = (token, secret) => {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    throw new Error("Invalid token format");
  }

  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid token signature");
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload));

  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Token expired");
  }

  return payload;
};
