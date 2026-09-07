import { CLOUD_FREE_LICENSING_PLAN, OPEN_SOURCE_LICENSING_PLAN, UNLIMITED } from "@langwatch/plans";
import type { PlanInfo } from "./license-plan.ts";

export const LICENSING_FEATURE_ID = "licensing" as const;

export const CONTACT_SALES_URL = "https://langwatch.ai/get-a-demo";

export const DEFAULT_LICENSE_PURCHASE_URL = "https://buy.stripe.com/dRm3cwaIDgXs6yK6sX0480f";

/**
 * Default limit for fields not present in older licenses. Using a large number instead of
 * Infinity for JSON serialization safety. Note: Infinity cannot be serialized to JSON (becomes
 * null), so we use Number.MAX_SAFE_INTEGER which is serializable and effectively unlimited.
 */
export const DEFAULT_LIMIT = UNLIMITED;

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
 * LICENSE_ERRORS: the verdicts `validateLicense` reports. These are SERVER discriminants, not
 * copy.
 */
export const LICENSE_ERRORS = {
  INVALID_FORMAT: "Invalid license format",
  INVALID_SIGNATURE: "Invalid signature",
  EXPIRED: "License expired",
  ORGANIZATION_MISMATCH: "License was issued for a different organization",
} as const;

export type LicenseError = (typeof LICENSE_ERRORS)[keyof typeof LICENSE_ERRORS];

/**
 * UNLIMITED_PLAN: the plan a self-hosted deployment runs on without a license. A license sells
 * the Enterprise surface (SSO, SCIM, audit logs) and support, not permission to run the
 * software, so nothing the deployment stores on its own infrastructure is capped here.
 */
export const UNLIMITED_PLAN: PlanInfo = OPEN_SOURCE_LICENSING_PLAN;

/**
 * FREE_PLAN: the Cloud free tier. Self-hosted deployments never land here. With no license, or
 * an expired or unreadable one, they resolve to UNLIMITED_PLAN.
 */
export const FREE_PLAN: PlanInfo = {
  ...CLOUD_FREE_LICENSING_PLAN,
  visibilityDays: FREE_VISIBILITY_DAYS,
};

/**
 * * Embedded production public key used when no env var is configured. * Enables license
 * verification out-of-the-box; override via env for rotation.
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
