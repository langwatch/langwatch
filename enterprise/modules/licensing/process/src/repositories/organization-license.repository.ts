import type { Instant } from "@langwatch/time";

/**
 * The one license read by plan resolution: the key an organization activated.
 * Narrower than LicenseStorage to avoid pulling seat-count enforcement into
 * plan-only processes.
 */
export interface OrganizationLicense {
  /** Throws `organization_not_found`; an unlicensed organization answers `licenseKey: null`. */
  getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }>;
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

/** The licence rows read and written, without the seat counts a peer answers. */
export interface OrganizationLicenseRepository extends OrganizationLicenseReads {
  organizationExists(organizationId: string): Promise<boolean>;
  storeLicense(organizationId: string, license: StoredLicense): Promise<void>;
  removeLicense(organizationId: string): Promise<void>;
}
