import type { PlanInfo } from "~/server/subscriptionHandler";

/**
 * LICENSE_ERRORS: Standardized error messages for license validation.
 * Used across validation.ts and types.ts to ensure consistency.
 */
export const LICENSE_ERRORS = {
  INVALID_FORMAT: "Invalid license format",
  INVALID_SIGNATURE: "Invalid signature",
  EXPIRED: "License expired",
} as const;

export type LicenseError = (typeof LICENSE_ERRORS)[keyof typeof LICENSE_ERRORS];

/**
 * Practical "unlimited" values for plan limits.
 *
 * These values are chosen to:
 * - Be high enough to never be reached in practice (effectively unlimited)
 * - Stay within safe integer ranges for database storage (no overflow risk)
 * - Use memorable patterns (9s) for easy identification in logs/debugging
 * - Signal "unlimited" intent without using Infinity or null (which complicate type handling)
 */
const UNLIMITED_MEMBERS = 99_999;
const UNLIMITED_PROJECTS = 9_999;
const UNLIMITED_MESSAGES = 999_999_999;
const UNLIMITED_EVALUATIONS = 999_999;
const UNLIMITED_WORKFLOWS = 9_999;

/**
 * UNLIMITED_PLAN: Default plan for self-hosted deployments without a license.
 * Maintains backward compatibility with current OSS behavior.
 */
export const UNLIMITED_PLAN: PlanInfo = {
  type: "OPEN_SOURCE",
  name: "Open Source",
  free: true,
  overrideAddingLimitations: true,
  maxMembers: UNLIMITED_MEMBERS,
  maxProjects: UNLIMITED_PROJECTS,
  maxMessagesPerMonth: UNLIMITED_MESSAGES,
  evaluationsCredit: UNLIMITED_EVALUATIONS,
  maxWorkflows: UNLIMITED_WORKFLOWS,
  canPublish: true,
  prices: {
    USD: 0,
    EUR: 0,
  },
};

/**
 * FREE_PLAN: Fallback plan for expired or invalid licenses.
 * Provides minimal access to encourage license renewal.
 */
export const FREE_PLAN: PlanInfo = {
  type: "FREE",
  name: "Free",
  free: true,
  overrideAddingLimitations: false,
  maxMembers: 2,
  maxProjects: 2,
  maxMessagesPerMonth: 1_000,
  evaluationsCredit: 2,
  maxWorkflows: 1,
  canPublish: false,
  prices: {
    USD: 0,
    EUR: 0,
  },
};

/**
 * Placeholder public key used when no env var is configured.
 * This will fail signature verification, which is the safe default.
 */
const PLACEHOLDER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
PLACEHOLDER_FOR_PRODUCTION_PUBLIC_KEY
-----END PUBLIC KEY-----`;

/**
 * PUBLIC_KEY: RSA public key for license signature verification.
 * This key is used to verify that licenses are signed by LangWatch.
 *
 * Set via LANGWATCH_LICENSE_PUBLIC_KEY environment variable in production.
 * Falls back to placeholder (which will fail validation) if not set.
 */
export const PUBLIC_KEY =
  process.env.LANGWATCH_LICENSE_PUBLIC_KEY ?? PLACEHOLDER_PUBLIC_KEY;
