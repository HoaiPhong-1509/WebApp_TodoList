import dns from "dns/promises";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const withTimeout = async (promise, timeoutMs) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("timeout")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const isValidEmailFormat = (email) => EMAIL_REGEX.test(email);

export const hasMxRecords = async (email) => {
  const domain = email.split("@")[1];

  if (!domain) {
    return false;
  }

  try {
    const timeoutMs = Number(process.env.MX_LOOKUP_TIMEOUT_MS || 2500);
    const records = await withTimeout(dns.resolveMx(domain), timeoutMs);
    return Array.isArray(records) && records.length > 0;
  } catch {
    // Avoid hanging / false negatives in restricted environments.
    // If MX lookup fails or times out, allow registration to proceed.
    return true;
  }
};
