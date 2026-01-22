import type { PlanInfo } from "~/server/subscriptionHandler";

/** Plan limits embedded within a license */
export interface LicensePlanLimits {
  type: string;
  name: string;
  maxMembers: number;
  maxProjects: number;
  maxMessagesPerMonth: number;
  evaluationsCredit: number;
  maxWorkflows: number;
  canPublish: boolean;
}

/** Core license data structure (the payload that gets signed) */
export interface LicenseData {
  licenseId: string;
  version: number;
  organizationName: string;
  email: string;
  issuedAt: string; // ISO 8601 date string
  expiresAt: string; // ISO 8601 date string
  plan: LicensePlanLimits;
}

/** A license with its RSA signature */
export interface SignedLicense {
  data: LicenseData;
  signature: string; // Base64-encoded RSA-SHA256 signature
}

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
