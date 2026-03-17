import dns from "dns/promises";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NEGATIVE_DNS_CODES = new Set(["ENOTFOUND", "ENODATA", "ENONAME", "NXDOMAIN"]);
const RESERVED_SUFFIXES = [".example", ".invalid", ".localhost", ".test"];
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "guerrillamail.com",
  "guerrillamail.net",
  "mailinator.com",
  "trashmail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "sharklasers.com",
  "getnada.com",
  "maildrop.cc",
  "dispostable.com",
  "fakeinbox.com",
  "moakt.com",
  "emailondeck.com",
]);
const ABSTRACT_EMAIL_API_URL = "https://emailvalidation.abstractapi.com/v1/";

const withTimeout = async (promise, timeoutMs) => {
  if (!timeoutMs || timeoutMs <= 0) {
    return promise;
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      const err = new Error("timeout");
      err.code = "ETIMEOUT";
      reject(err);
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
};

export const isValidEmailFormat = (email) => EMAIL_REGEX.test(email);

const isReservedDomain = (domain) => {
  const normalized = String(domain || "").toLowerCase();
  if (!normalized) {
    return true;
  }

  return RESERVED_SUFFIXES.some((suffix) => normalized === suffix.slice(1) || normalized.endsWith(suffix));
};

const isDisposableDomain = (domain) => DISPOSABLE_EMAIL_DOMAINS.has(String(domain || "").toLowerCase());

const shouldAllowOnDnsTimeout = () => {
  const raw = process.env.EMAIL_DNS_ALLOW_ON_TIMEOUT;
  if (raw === undefined) return false;
  return String(raw).toLowerCase() === "true";
};

const shouldAllowOnUnknownDnsError = () => {
  const raw = process.env.EMAIL_DNS_ALLOW_ON_ERROR;
  if (raw === undefined) return false;
  return String(raw).toLowerCase() === "true";
};

const hasAddressRecords = async (domain, timeoutMs) => {
  const [ipv4Records, ipv6Records] = await Promise.allSettled([
    withTimeout(dns.resolve4(domain), timeoutMs),
    withTimeout(dns.resolve6(domain), timeoutMs),
  ]);

  const hasIpv4 = ipv4Records.status === "fulfilled" && Array.isArray(ipv4Records.value) && ipv4Records.value.length > 0;
  const hasIpv6 = ipv6Records.status === "fulfilled" && Array.isArray(ipv6Records.value) && ipv6Records.value.length > 0;

  return hasIpv4 || hasIpv6;
};

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return String(value).toLowerCase() === "true";
};

const getEmailValidationTimeoutMs = () => {
  const val = Number(process.env.EMAIL_VALIDATION_TIMEOUT_MS || 4000);
  if (!Number.isFinite(val) || val <= 0) {
    return 4000;
  }
  return Math.min(Math.max(val, 1000), 15000);
};

const validateMailboxWithAbstractApi = async (email) => {
  const apiKey = process.env.EMAIL_VALIDATION_API_KEY;
  if (!apiKey) {
    return { checked: false, deliverable: null, reason: "validator_not_configured" };
  }

  const timeoutMs = getEmailValidationTimeoutMs();
  const url = new URL(ABSTRACT_EMAIL_API_URL);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("email", email);

  try {
    const response = await withTimeout(fetch(url.toString()), timeoutMs);
    if (!response.ok) {
      return { checked: true, deliverable: null, reason: `validator_http_${response.status}` };
    }

    const payload = await response.json();
    const deliverability = String(payload?.deliverability || "").toUpperCase();
    const smtpValid = payload?.is_smtp_valid?.value;

    // Accept only clear deliverable result when provider can determine it.
    if (deliverability === "DELIVERABLE" || smtpValid === true) {
      return { checked: true, deliverable: true, reason: "validator_deliverable" };
    }

    if (deliverability === "UNDELIVERABLE" || smtpValid === false) {
      return { checked: true, deliverable: false, reason: "validator_undeliverable" };
    }

    return { checked: true, deliverable: null, reason: "validator_unknown" };
  } catch (error) {
    const code = String(error?.code || "").toUpperCase();
    if (code === "ETIMEOUT") {
      return { checked: true, deliverable: null, reason: "validator_timeout" };
    }
    return { checked: true, deliverable: null, reason: "validator_error" };
  }
};

export const hasMxRecords = async (email) => {
  const domain = String(email || "").split("@")[1]?.toLowerCase();

  if (!domain) {
    return false;
  }

  // RFC-reserved domains are guaranteed non-deliverable.
  if (isReservedDomain(domain)) {
    return false;
  }

  try {
    const timeoutMs = Number(process.env.MX_LOOKUP_TIMEOUT_MS || 2500);
    const records = await withTimeout(dns.resolveMx(domain), timeoutMs);
    if (Array.isArray(records) && records.length > 0) {
      return true;
    }

    // RFC-compliant fallback: if no MX exists, mail may still be delivered to A/AAAA.
    return hasAddressRecords(domain, timeoutMs);
  } catch (error) {
    const code = String(error?.code || "").toUpperCase();
    if (NEGATIVE_DNS_CODES.has(code)) {
      return false;
    }

    if (code === "ETIMEOUT") {
      return shouldAllowOnDnsTimeout();
    }

    return shouldAllowOnUnknownDnsError();
  }
};

export const validateEmailDeliverability = async (email) => {
  if (!isValidEmailFormat(email)) {
    return { ok: false, reason: "invalid_format" };
  }

  const domain = String(email || "").split("@")[1]?.toLowerCase();
  if (isDisposableDomain(domain)) {
    return { ok: false, reason: "disposable_domain" };
  }

  const domainCanReceiveMail = await hasMxRecords(email);
  if (!domainCanReceiveMail) {
    return { ok: false, reason: "invalid_domain" };
  }

  const providerResult = await validateMailboxWithAbstractApi(email);
  const requireProviderValidation = toBoolean(process.env.EMAIL_REQUIRE_PROVIDER_VALIDATION, false);
  const allowUnknownProviderResult = toBoolean(process.env.EMAIL_ALLOW_UNKNOWN_PROVIDER_RESULT, true);

  if (!providerResult.checked) {
    return requireProviderValidation
      ? { ok: false, reason: "validator_not_configured" }
      : { ok: true, reason: "dns_only_pass" };
  }

  if (providerResult.deliverable === true) {
    return { ok: true, reason: "validator_pass" };
  }

  if (providerResult.deliverable === false) {
    return { ok: false, reason: "undeliverable_mailbox" };
  }

  if (requireProviderValidation && !allowUnknownProviderResult) {
    return { ok: false, reason: providerResult.reason || "validator_unknown" };
  }

  return { ok: true, reason: providerResult.reason || "validator_unknown_allowed" };
};
