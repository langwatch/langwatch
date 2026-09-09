import { z } from "zod";
import type { LicenseError } from "./license-constants.ts";
import { planSchema } from "@langwatch/entitlement-contract";
import {
  licenseResourceLimitsShape,
  licenseSeatsShape,
  planPublishingShape,
} from "@langwatch/plans";
import type { PlanInfo } from "./license-plan.ts";

/**
 * Plan limits embedded within a license (the signed payload).
 */
export const licensePlanLimitsSchema = z.object({
  type: z.string(),
  name: z.string(),
  ...licenseSeatsShape,
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
  ...planPublishingShape,
  // Webhook endpoints platform: optional so licenses signed before the
  // feature existed keep validating; absent means false.
  webhookEndpointsEnabled: z.boolean().optional(),
  // Usage counting mode - optional for backward compatibility with existing signed licenses
  // Uses z.string() (not z.enum) for forward compatibility: future values won't break old deployments
  usageUnit: z.string().optional(),
});

export type LicensePlanLimits = z.infer<typeof licensePlanLimitsSchema>;

/** Core license data structure (the payload that gets signed) */
export const licenseDataSchema = z.object({
  licenseId: z.string(),
  version: z.number(),
  organizationName: z.string(),
  email: z.string(),
  issuedAt: z.string(), // ISO 8601 date string
  expiresAt: z.string(), // ISO 8601 date string
  plan: licensePlanLimitsSchema,
  // The organization the key was issued for, and the only thing that stops a
  // signed key activating anywhere. LAST and optional on purpose: every key
  // issued before this field existed must still re-serialize to the exact
  // bytes it was signed over, so the position and the optionality are part of
  // the signature contract, not style.
  organizationId: z.string().optional(),
});

export type LicenseData = z.infer<typeof licenseDataSchema>;

/** A license with its RSA signature */
export const signedLicenseSchema = z.object({
  data: licenseDataSchema,
  signature: z.string(), // Base64-encoded RSA-SHA256 signature
});

export type SignedLicense = z.infer<typeof signedLicenseSchema>;

export const platformLicenseInspectionSchema = z.discriminatedUnion("valid", [
  z.object({
    source: z.enum(["instance", "organization"]),
    organizationId: z.string().optional(),
    valid: z.literal(false),
    reason: z.enum(["invalid_format", "invalid_signature", "organization_mismatch"]),
  }),
  z.object({
    source: z.enum(["instance", "organization"]),
    organizationId: z.string().optional(),
    valid: z.literal(true),
    expiresAt: z.string(),
    organizationName: z.string(),
    expired: z.boolean(),
  }),
]);

export const platformLicenseAccessSchema = z.object({
  allowed: z.boolean(),
  inspections: z.array(platformLicenseInspectionSchema),
});

export type PlatformLicenseInspection = z.infer<typeof platformLicenseInspectionSchema>;
export type PlatformLicenseAccess = z.infer<typeof platformLicenseAccessSchema>;

/** Compatibility aliases retained while callers migrate schema casing. */
export const LicensePlanLimitsSchema = licensePlanLimitsSchema;
export const LicenseDataSchema = licenseDataSchema;
export const SignedLicenseSchema = signedLicenseSchema;

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
  /**
   * True when the license is one LangWatch signed and its term simply ended, false when the
   * signature does not check out. Only the first still meters seats, so the page needs the
   * distinction and cannot derive it from `expiresAt`, which an unsigned payload controls.
   */
  expired: boolean;
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

export type LicenseStatus =
  | NoLicenseStatus
  | UnreadableLicenseStatus
  | InvalidLicenseStatus
  | ValidLicenseStatus;

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

const licenseMetadataShape = {
  plan: z.string(),
  planName: z.string(),
  expiresAt: z.string(),
  organizationName: z.string(),
} as const;

/**
 * The license an organization is running on, as its settings page reads it.
 *
 * Four answers, not one with optional fields: no license at all, a license too
 * corrupted to read anything out of, one that reads but does not check out,
 * and a good one. Only the last two carry seat and volume figures, because
 * only they have a plan to measure against.
 */
export const licenseStatusSchema: z.ZodType<LicenseStatus> = z.union([
  z.object({ hasLicense: z.literal(false), valid: z.literal(false) }).strict(),
  z
    .object({ hasLicense: z.literal(true), valid: z.literal(false), corrupted: z.literal(true) })
    .strict(),
  z
    .object({
      hasLicense: z.literal(true),
      valid: z.literal(false),
      corrupted: z.literal(false).optional(),
      /**
       * True when LangWatch signed it and the term simply ended, false when the
       * signature does not check out. Only the first still meters seats.
       */
      expired: z.boolean(),
      ...licenseMetadataShape,
      ...licenseResourceLimitsShape,
    })
    .strict(),
  z
    .object({
      hasLicense: z.literal(true),
      valid: z.literal(true),
      ...licenseMetadataShape,
      ...licenseResourceLimitsShape,
    })
    .strict(),
]);

/** Why a deployment configured for single sign-on is not using it. */
export const ssoGateStatusSchema = z
  .object({
    configuredProvider: z.string().nullable(),
    licensed: z.boolean(),
    mounted: z.boolean(),
  })
  .strict();

/**
 * `mounted` is reported apart from `licensed` because the two are fixed in
 * different places: one by activating a license, the other by correcting the
 * provider name or its client credentials.
 */
export type SsoGateStatus = z.infer<typeof ssoGateStatusSchema>;

/** A pasted key was accepted, with the plan it resolved to. */
export const licenseUploadedSchema = z
  .object({ success: z.literal(true), planInfo: planSchema })
  .strict();

/** A key was dropped, returning the organization to the free tier. */
export const licenseRemovedSchema = z
  .object({ success: z.literal(true), removed: z.literal(true) })
  .strict();

/** A freshly minted and signed key. The one answer that carries one. */
export const licenseGeneratedSchema = z.object({ licenseKey: z.string() }).strict();
