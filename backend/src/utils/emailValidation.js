import dns from "dns/promises";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isValidEmailFormat = (email) => EMAIL_REGEX.test(email);

export const hasMxRecords = async (email) => {
  const domain = email.split("@")[1];

  if (!domain) {
    return false;
  }

  try {
    const records = await dns.resolveMx(domain);
    return Array.isArray(records) && records.length > 0;
  } catch {
    return false;
  }
};
