import type { PlanInfo } from "~/server/subscriptionHandler";

/**
 * UNLIMITED_PLAN: Default plan for self-hosted deployments without a license.
 * Maintains backward compatibility with current OSS behavior.
 */
export const UNLIMITED_PLAN: PlanInfo = {
  type: "OPEN_SOURCE",
  name: "Open Source",
  free: true,
  overrideAddingLimitations: true,
  maxMembers: 99_999,
  maxProjects: 9_999,
  maxMessagesPerMonth: 999_999_999,
  evaluationsCredit: 999_999,
  maxWorkflows: 9_999,
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
