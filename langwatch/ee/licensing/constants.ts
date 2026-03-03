import type { PlanInfo } from "./planInfo";

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

/**
 * User-friendly error messages for display in the UI.
 * Maps technical errors to human-readable messages.
 */
export const LICENSE_ERROR_MESSAGES = {
  [LICENSE_ERRORS.INVALID_FORMAT]:
    "The license key is invalid or has been tampered with. Please check the key and try again.",
  [LICENSE_ERRORS.INVALID_SIGNATURE]:
    "The license key is invalid or has been tampered with. Please check the key and try again.",
  [LICENSE_ERRORS.EXPIRED]:
    "This license has expired. Please contact support to renew your license.",
} as const;

/**
 * Returns a user-friendly error message for a given license error.
 * Falls back to the original error if not found in the mapping.
 */
export function getUserFriendlyLicenseError(error: string): string {
  return (
    LICENSE_ERROR_MESSAGES[error as keyof typeof LICENSE_ERROR_MESSAGES] ??
    error
  );
}

export type LicenseError = (typeof LICENSE_ERRORS)[keyof typeof LICENSE_ERRORS];

/** Free tier resource limits - designed for individual evaluation/POC use */
const FREE_TIER_LIMITS = {
  /** Single operator model */
  MEMBERS: 1,
  /** Members Lite requires paid plan */
  MEMBERS_LITE: 0,
  /** Single team for individual use */
  TEAMS: 1,
  /** Enough for a small POC */
  PROJECTS: 2,
  /** Minimal experimentation allowance */
  WORKFLOWS: 3,
  /** Minimal experimentation allowance */
  PROMPTS: 3,
  /** Minimal experimentation allowance */
  EVALUATORS: 3,
  /** Minimal experimentation allowance */
  SCENARIOS: 3,
  /** Minimal experimentation allowance */
  AGENTS: 3,
  /** Minimal experimentation allowance */
  EXPERIMENTS: 3,
  /** Minimal experimentation allowance */
  ONLINE_EVALUATIONS: 3,
  /** Minimal experimentation allowance */
  DATASETS: 3,
  /** Minimal experimentation allowance */
  DASHBOARDS: 3,
  /** Minimal experimentation allowance */
  CUSTOM_GRAPHS: 3,
  /** Minimal experimentation allowance */
  AUTOMATIONS: 3,
  /** ~33 messages per day */
  MESSAGES_PER_MONTH: 1_000,
  /** Just enough to try the feature */
  EVALUATIONS_CREDIT: 2,
} as const;

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
  planSource: "free",
  type: "OPEN_SOURCE",
  name: "Open Source",
  free: true,
  overrideAddingLimitations: true,
  maxMembers: Number.MAX_SAFE_INTEGER,
  maxMembersLite: Number.MAX_SAFE_INTEGER,
  maxTeams: Number.MAX_SAFE_INTEGER,
  maxProjects: Number.MAX_SAFE_INTEGER,
  maxMessagesPerMonth: Number.MAX_SAFE_INTEGER,
  evaluationsCredit: Number.MAX_SAFE_INTEGER,
  maxWorkflows: Number.MAX_SAFE_INTEGER,
  maxPrompts: Number.MAX_SAFE_INTEGER,
  maxEvaluators: Number.MAX_SAFE_INTEGER,
  maxScenarios: Number.MAX_SAFE_INTEGER,
  maxAgents: Number.MAX_SAFE_INTEGER,
  maxExperiments: Number.MAX_SAFE_INTEGER,
  maxOnlineEvaluations: Number.MAX_SAFE_INTEGER,
  maxDatasets: Number.MAX_SAFE_INTEGER,
  maxDashboards: Number.MAX_SAFE_INTEGER,
  maxCustomGraphs: Number.MAX_SAFE_INTEGER,
  maxAutomations: Number.MAX_SAFE_INTEGER,
  canPublish: true,
  usageUnit: "traces",
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
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  overrideAddingLimitations: false,

  maxMessagesPerMonth: FREE_TIER_LIMITS.MESSAGES_PER_MONTH,
  evaluationsCredit: FREE_TIER_LIMITS.EVALUATIONS_CREDIT,

  maxMembers: FREE_TIER_LIMITS.MEMBERS,
  maxMembersLite: FREE_TIER_LIMITS.MEMBERS_LITE,
  maxTeams: FREE_TIER_LIMITS.TEAMS,
  maxProjects: FREE_TIER_LIMITS.PROJECTS,

  maxWorkflows: FREE_TIER_LIMITS.WORKFLOWS,
  maxPrompts: FREE_TIER_LIMITS.PROMPTS,
  maxEvaluators: FREE_TIER_LIMITS.EVALUATORS,
  maxScenarios: FREE_TIER_LIMITS.SCENARIOS,
  maxAgents: FREE_TIER_LIMITS.AGENTS,
  maxExperiments: FREE_TIER_LIMITS.EXPERIMENTS,
  maxOnlineEvaluations: FREE_TIER_LIMITS.ONLINE_EVALUATIONS,
  maxDatasets: FREE_TIER_LIMITS.DATASETS,
  maxDashboards: FREE_TIER_LIMITS.DASHBOARDS,
  maxCustomGraphs: FREE_TIER_LIMITS.CUSTOM_GRAPHS,
  maxAutomations: FREE_TIER_LIMITS.AUTOMATIONS,
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

const PLACEHOLDER_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvyNNiu5B0lretFaxowsu
fM907tHWnBITXVDfnpPAwUgzrODdjfTt73XW1S+EDd8AM0FzOpx0YolXipS4+SNK
axSXwNO0S0XjJGLW7wz9Nv8/PP9V23LtiLQQOj8eGol/texr5pIZy2CRjVeEYcBZ
GCNz8mT/4tEM8v/NaoTFngsRwNJTuRlro+MZF7eArdBmtIU1fNLchZEH2kojMHKj
8vMIyZoTXB4TF/9iXL40eJQUWrVM1llGzJrZ7GhD3lIeyiZz+cQvako1BIthRuUa
2qLWpbVP63RSjxphslVvXk1RycL3esr2cj0Pe8loWxeKoxWjnXdLJYWygQh8aUbZ
iQIDAQAB
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
