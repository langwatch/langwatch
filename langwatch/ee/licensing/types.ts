import { z } from "zod";
import type { PlanInfo } from "~/server/subscriptionHandler";

/** Plan limits embedded within a license */
export const LicensePlanLimitsSchema = z.object({
  type: z.string(),
  name: z.string(),
  maxMembers: z.number(),
  maxProjects: z.number(),
  maxMessagesPerMonth: z.number(),
  evaluationsCredit: z.number(),
  maxWorkflows: z.number(),
  canPublish: z.boolean(),
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
      error: "Invalid license format" | "Invalid signature" | "License expired";
    };

/** License status for API responses */
export interface LicenseStatus {
  hasLicense: boolean;
  valid: boolean;
  plan?: string;
  planName?: string;
  expiresAt?: string;
  organizationName?: string;
  currentMembers?: number;
  maxMembers?: number;
}

/** Result of storing a license */
export type StoreLicenseResult =
  | {
      success: true;
      planInfo: PlanInfo;
    }
  | {
      success: false;
      error: string;
    };
