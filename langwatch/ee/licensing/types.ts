import { z } from "zod";
import type { PlanInfo } from "./planInfo";
import type { LicenseError } from "./constants";

/**
 * Plan limits embedded within a license (the signed payload).
 *
 * IMPORTANT: The workspace-structure fields (maxProjects, maxTeams) and the
 * experimentation fields below (maxWorkflows, maxPrompts, maxEvaluators,
 * maxScenarios, maxAgents, maxExperiments, maxOnlineEvaluations, maxDatasets,
 * maxDashboards, maxCustomGraphs) are NO LONGER ENFORCED — those resources are
 * OSS/Apache-2.0 and uncapped. They are retained in this schema purely for
 * backward compatibility: `verifySignature` re-serializes the Zod-parsed
 * `data`, and `z.object` strips unknown keys, so dropping a field here would
 * change the JSON for already-issued licenses and break their signature
 * verification. They are all optional (existing licenses that carry a value
 * still parse and re-serialize byte-identically); they are simply ignored
 * downstream.
 */
export const LicensePlanLimitsSchema = z.object({
  type: z.string(),
  name: z.string(),
  maxMembers: z.number(),
  maxMembersLite: z.number().optional(),
  maxTeams: z.number().optional(),
  maxProjects: z.number().optional(),
  maxMessagesPerMonth: z.number(),
  // evaluationsCredit kept optional for backward compat: old signed licenses
  // include this field. Stripping it would change the JSON, breaking signature
  // verification. The field is otherwise unused (never enforced).
  evaluationsCredit: z.number().optional(),
  maxWorkflows: z.number().optional(),
  // New fields - optional for backward compatibility with existing signed licenses
  maxPrompts: z.number().optional(),
  maxEvaluators: z.number().optional(),
  maxScenarios: z.number().optional(),
  maxAgents: z.number().optional(),
  maxExperiments: z.number().optional(),
  maxOnlineEvaluations: z.number().optional(),
  maxDatasets: z.number().optional(),
  maxDashboards: z.number().optional(),
  maxCustomGraphs: z.number().optional(),
  maxAutomations: z.number().optional(),
  canPublish: z.boolean(),
  // Usage counting mode - optional for backward compatibility with existing signed licenses
  // Uses z.string() (not z.enum) for forward compatibility: future values won't break old deployments
  usageUnit: z.string().optional(),
});

export type LicensePlanLimits = z.infer<typeof LicensePlanLimitsSchema>;

/** Core license data structure (the payload that gets signed) */
export const LicenseDataSchema = z.object({
  licenseId: z.string(),
  version: z.number(),
  organizationName: z.string(),
  email: z.string(),
  issuedAt: z.string(), // ISO 8601 date string
  expiresAt: z.string(), // ISO 8601 date string
  plan: LicensePlanLimitsSchema,
});

export type LicenseData = z.infer<typeof LicenseDataSchema>;

/** A license with its RSA signature */
export const SignedLicenseSchema = z.object({
  data: LicenseDataSchema,
  signature: z.string(), // Base64-encoded RSA-SHA256 signature
});

export type SignedLicense = z.infer<typeof SignedLicenseSchema>;

/** Result of license validation */
export type ValidationResult =
  | {
      valid: true;
      licenseData: LicenseData;
      planInfo: PlanInfo;
    }
  | {
      valid: false;
      error: LicenseError;
    };

/** License status for API responses - discriminated union for type safety */
type NoLicenseStatus = {
  hasLicense: false;
  valid: false;
};

/** License exists but is corrupted/unreadable - no metadata can be extracted */
type UnreadableLicenseStatus = {
  hasLicense: true;
  valid: false;
  corrupted: true;
};

/** Resource usage and limits for license status */
type LicenseResourceLimits = {
  currentMembers: number;
  maxMembers: number;
  currentMembersLite: number;
  maxMembersLite: number;
  currentMessagesPerMonth: number;
  maxMessagesPerMonth: number;
};

type InvalidLicenseStatus = {
  hasLicense: true;
  valid: false;
  corrupted?: false;
  plan: string;
  planName: string;
  expiresAt: string;
  organizationName: string;
} & LicenseResourceLimits;

type ValidLicenseStatus = {
  hasLicense: true;
  valid: true;
  plan: string;
  planName: string;
  expiresAt: string;
  organizationName: string;
} & LicenseResourceLimits;

export type LicenseStatus = NoLicenseStatus | UnreadableLicenseStatus | InvalidLicenseStatus | ValidLicenseStatus;

/** Result of storing a license */
export type StoreLicenseResult =
  | {
      success: true;
      planInfo: PlanInfo;
    }
  | {
      success: false;
      error: LicenseError;
    };

/** Result of removing a license */
export type RemoveLicenseResult = {
  /** Always true on success. Throws OrganizationNotFoundError if org doesn't exist. */
  removed: true;
};
