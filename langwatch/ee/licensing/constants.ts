import type { PlanInfo } from "~/server/subscriptionHandler";

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
 * UNLIMITED_PLAN: Default plan for self-hosted deployments without a license.
 * Maintains backward compatibility with current OSS behavior.
 *
 * Uses Number.MAX_SAFE_INTEGER instead of Infinity because:
 * - JSON.stringify(Infinity) returns null, causing silent failures in tRPC
 * - Number.MAX_SAFE_INTEGER is effectively unlimited for practical purposes
 * - The value is 9,007,199,254,740,991 - far beyond any real limit
 */
export const UNLIMITED_PLAN: PlanInfo = {
  type: "OPEN_SOURCE",
  name: "Open Source",
  free: true,
  overrideAddingLimitations: true,
  maxMembers: Number.MAX_SAFE_INTEGER,
  maxMembersLite: Number.MAX_SAFE_INTEGER,
  maxProjects: Number.MAX_SAFE_INTEGER,
  maxMessagesPerMonth: Number.MAX_SAFE_INTEGER,
  evaluationsCredit: Number.MAX_SAFE_INTEGER,
  maxWorkflows: Number.MAX_SAFE_INTEGER,
  maxPrompts: Number.MAX_SAFE_INTEGER,
  maxEvaluators: Number.MAX_SAFE_INTEGER,
  maxScenarios: Number.MAX_SAFE_INTEGER,
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

  maxMessagesPerMonth: 1_000,
  evaluationsCredit: 2,

  maxMembers: 1,
  maxMembersLite: 1,
  maxProjects: 2,

  maxWorkflows: 3,
  maxPrompts: 3,
  maxEvaluators: 3,
  maxScenarios: 3,
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
