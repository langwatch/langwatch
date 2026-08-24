import type { PlanInfo } from "./license-plan";

export const LICENSING_FEATURE_ID = "licensing" as const;

export const CONTACT_SALES_URL = "https://langwatch.ai/get-a-demo";

export const DEFAULT_LICENSE_PURCHASE_URL =
  "https://buy.stripe.com/dRm3cwaIDgXs6yK6sX0480f";

/**
 * Default limit for fields not present in older licenses.
 * Using a large number instead of Infinity for JSON serialization safety.
 * Note: Infinity cannot be serialized to JSON (becomes null), so we use
 * Number.MAX_SAFE_INTEGER which is serializable and effectively unlimited.
 */
export const DEFAULT_LIMIT = Number.MAX_SAFE_INTEGER;

/**
 * Default value for maxMembersLite when not specified in license.
 */
export const DEFAULT_MEMBERS_LITE = 1;

/**
 * Free-tier read-path visibility window: trace content older than this many
 * days is teaser-redacted for free plans. Visibility, not retention —
 * deletion stays at the org's retention policy.
 */
export const FREE_VISIBILITY_DAYS = 14;

/**
 * LICENSE_ERRORS: the verdicts `validateLicense` reports.
 *
 * These are SERVER discriminants, not copy. What a customer reads about an
 * invalid or expired licence comes from the code-keyed presentation registry
 * (`license_key_invalid` / `license_expired`), reached via
 * `licenseValidationError` in `./errors`. The prose-keyed lookup that used to
 * live here — `LICENSE_ERROR_MESSAGES` and `getUserFriendlyLicenseError` —
 * string-matched these literals to pick a sentence, which made the customer's
 * copy depend on the exact wording of an internal enum.
 */
export const LICENSE_ERRORS = {
  INVALID_FORMAT: "Invalid license format",
  INVALID_SIGNATURE: "Invalid signature",
  EXPIRED: "License expired",
} as const;

export type LicenseError = (typeof LICENSE_ERRORS)[keyof typeof LICENSE_ERRORS];

/** Cloud free tier resource limits - designed for individual evaluation/POC use */
const FREE_TIER_LIMITS = {
  /** Single operator model */
  MEMBERS: 1,
  /** Members Lite requires paid plan */
  MEMBERS_LITE: 0,
  /** ~33 messages per day */
  MESSAGES_PER_MONTH: 1_000,
} as const;

/**
 * UNLIMITED_PLAN: the plan a self-hosted deployment runs on without a license.
 *
 * A license sells the Enterprise surface (SSO, SCIM, audit logs) and support,
 * not permission to run the software, so nothing the deployment stores on its
 * own infrastructure is capped here.
 *
 * Uses Number.MAX_SAFE_INTEGER instead of Infinity because:
 * - JSON.stringify(Infinity) returns null, causing silent failures in tRPC
 * - Number.MAX_SAFE_INTEGER is effectively unlimited for practical purposes
 * - The value is 9,007,199,254,740,991 - far beyond any real limit
 */
export const UNLIMITED_PLAN: PlanInfo = {
  planSource: "free",
  type: "OPEN_SOURCE",
  name: "Open Source",
  free: true,
  overrideAddingLimitations: true,
  maxMembers: Number.MAX_SAFE_INTEGER,
  maxMembersLite: Number.MAX_SAFE_INTEGER,
  maxMessagesPerMonth: Number.MAX_SAFE_INTEGER,
  canPublish: true,
  usageUnit: "traces",
  prices: {
    USD: 0,
    EUR: 0,
  },
};

/**
 * FREE_PLAN: the Cloud free tier.
 *
 * Self-hosted deployments never land here. With no license, or an expired or
 * unreadable one, they resolve to UNLIMITED_PLAN.
 */
export const FREE_PLAN: PlanInfo = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  visibilityDays: FREE_VISIBILITY_DAYS,
  overrideAddingLimitations: false,

  maxMessagesPerMonth: FREE_TIER_LIMITS.MESSAGES_PER_MONTH,

  maxMembers: FREE_TIER_LIMITS.MEMBERS,
  maxMembersLite: FREE_TIER_LIMITS.MEMBERS_LITE,

  canPublish: false,
  usageUnit: "traces",
  prices: {
    USD: 0,
    EUR: 0,
  },
};

/**
 * * Embedded production public key used when no env var is configured.
 * * Enables license verification out-of-the-box; override via env for rotation.
 * DO NOT REPLACE WITH A PLACEHOLDER, LEAVE IT AS IS.
 */
// gitleaks:allow — public keys

export const DEFAULT_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvyNNiu5B0lretFaxowsu
fM907tHWnBITXVDfnpPAwUgzrODdjfTt73XW1S+EDd8AM0FzOpx0YolXipS4+SNK
axSXwNO0S0XjJGLW7wz9Nv8/PP9V23LtiLQQOj8eGol/texr5pIZy2CRjVeEYcBZ
GCNz8mT/4tEM8v/NaoTFngsRwNJTuRlro+MZF7eArdBmtIU1fNLchZEH2kojMHKj
8vMIyZoTXB4TF/9iXL40eJQUWrVM1llGzJrZ7GhD3lIeyiZz+cQvako1BIthRuUa
2qLWpbVP63RSjxphslVvXk1RycL3esr2cj0Pe8loWxeKoxWjnXdLJYWygQh8aUbZ
iQIDAQAB
-----END PUBLIC KEY-----`;
