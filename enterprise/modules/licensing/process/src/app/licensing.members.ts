import type {
  LicenseData,
  SignedLicense,
  ValidationResult,
} from "@langwatch/enterprise-licensing-contract";
import type { Instant } from "@langwatch/time";

export interface LicenseCryptography {
  parseLicenseKey(licenseKey: string): SignedLicense | null;
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
 * The one license read by plan resolution: the key an organization activated.
 * Narrower than LicenseStorage to avoid pulling seat-count enforcement into
 * plan-only processes.
 */
export interface OrganizationLicense {
  tryReadLicense(organizationId: string): Promise<string | null>;
}

export type StoredLicense = {
  licenseKey: string;
  expiresAt: Instant;
  validatedAt: Instant;
};

export type OrganizationLicenseCandidate = {
  organizationId: string;
  licenseKey: string;
};

/**
 * The platform-access scan: every organization running on an activated key.
 * An installation with no instance key is licensed by these rows alone.
 */
export interface OrganizationLicenseCandidates {
  findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]>;
}

/** Both licence reads, which is what a repository over the rows answers. */
export interface OrganizationLicenseReads
  extends OrganizationLicense, OrganizationLicenseCandidates {}

/**
 * Persistence and seat-count port. Concrete database adapters stay in
 * apps, except the reads, inherited from `OrganizationLicenseReads` so a
 * plan-resolution-only process can compose those alone, without seats.
 */
export interface LicenseStorage extends OrganizationLicenseReads {
  organizationExists(organizationId: string): Promise<boolean>;
  storeLicense(organizationId: string, license: StoredLicense): Promise<void>;
  removeLicense(organizationId: string): Promise<void>;
  getMemberCount(organizationId: string): Promise<number>;
  getMembersLiteCount(organizationId: string): Promise<number>;
}
