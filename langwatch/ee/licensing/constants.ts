import type { PlanInfo } from "~/server/subscriptionHandler";

/**
 * UNLIMITED_PLAN: Default plan for self-hosted deployments without a license.
 * Maintains backward compatibility with current OSS behavior.
 */
export const UNLIMITED_PLAN: PlanInfo = {
  type: "SELF_HOSTED",
  name: "Self-Hosted (Unlimited)",
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
 * PUBLIC_KEY: RSA public key for license signature verification.
 * This key is used to verify that licenses are signed by LangWatch.
 *
 * In production, this should be replaced with the actual production public key.
 * For now, we use a placeholder that will be replaced during deployment.
 */
export const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
PLACEHOLDER_FOR_PRODUCTION_PUBLIC_KEY
-----END PUBLIC KEY-----`;
