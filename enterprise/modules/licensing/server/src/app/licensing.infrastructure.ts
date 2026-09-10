import type { LicenseData, SignedLicense, ValidationResult } from "@langwatch/enterprise-licensing-contract";
export interface LicensingInfrastructure {  licenseCryptography: LicenseCryptography;
  licenseLogger: LicenseLogger;
  licenseRetention: LicenseRetention;
  licenseUsage: LicenseUsage;
  organizationLicense: OrganizationLicense;
}


export interface LicenseCryptography {
  tryParseLicenseKey(licenseKey: string): SignedLicense | null;
  verifySignature(signedLicense: SignedLicense, publicKey?: string): boolean;
  isExpired(expiresAt: string, now?: Instant): boolean;
  validateLicense(input: {
    licenseKey: string;
    publicKey?: string;
    now?: Instant;
  }): ValidationResult;
  signLicense(data: LicenseData, privateKey: string): SignedLicense;
  encodeLicenseKey(signedLicense: SignedLicense): string;
  generateLicenseId(): string;
}


export interface LicenseLogger {
  error(fields: Record<string, unknown>, message: string): void;
}

export type LicenseRetentionRule = {
  scopeType: string;
  scopeId: string;
  category: string;
};


export interface LicenseRetention {
  listOrganizationRules(organizationId: string): Promise<readonly LicenseRetentionRule[]>;

  setForOrganization(input: {
    organizationId: string;
    category: string;
    retentionDays: number;
  }): Promise<void>;
}

export type LicenseUsageCount = number | "unlimited" | "unknown";


export interface LicenseUsage {
  getCurrentMonthCount(input: { organizationId: string }): Promise<LicenseUsageCount>;
}

/**
 * The one licence read a plan resolution makes: the key an organization
 * activated, or nothing.
 *
 * Deliberately narrower than {@link LicenseStoragePort}, which also writes the
 * licence row and answers SEAT COUNTS. Those counts belong to the licence
 * ENFORCEMENT vertical — full-versus-lite classification, pending invitations,
 * custom roles — and a process that only resolves plans has no reason to
 * compose them. Asking for the whole storage port there would make every root
 * that reads a licence carry a collaborator nothing on that path calls.
 */
export interface OrganizationLicense {
  tryReadLicense(organizationId: string): Promise<string | null>;
}
