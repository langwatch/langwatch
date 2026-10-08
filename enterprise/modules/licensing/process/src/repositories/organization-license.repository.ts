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

/** A minted license has not been validated yet, so its stamp may be absent. */
export type StoredLicense = {
  licenseKey: string;
  expiresAt: Instant;
  validatedAt: Instant | null;
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

/** A licence as organization's columns or licensing's row hold it; a cleared one has no key. */
export type LicenseColumns = Readonly<{
  licenseKey: string | null;
  expiresAt: Instant | null;
  validatedAt: Instant | null;
}>;

/** One organization's columns beside licensing's row for it, which may not exist yet. */
export type OrganizationLicensePair = Readonly<{
  organizationId: string;
  columns: LicenseColumns;
  own: LicenseColumns | null;
}>;

/**
 * Licensing's own licence rows (round 37 D6). Until the copy step has run, an
 * organization with no row is read from organization's columns, which stay
 * written through `setLicense` and `clearLicense` until organization reads here.
 */
export interface OrganizationLicenseRepository extends OrganizationLicenseReads {
  organizationExists(organizationId: string): Promise<boolean>;
  saveLicense(input: Readonly<{ organizationId: string; license: StoredLicense }>): Promise<void>;
  /** Keeps the row with no key, so a cleared licence never falls back to organization's columns. */
  clearLicense(input: Readonly<{ organizationId: string }>): Promise<void>;
  /** One page of up to `limit` organizations in id order, each beside its row here. */
  findLicensePairs(
    input: Readonly<{ afterOrganizationId: string | null; limit: number }>,
  ): Promise<OrganizationLicensePair[]>;
  /** Writes each pair's columns only where its row is still `own`, so a newer write is kept. */
  overwriteLicenses(
    input: Readonly<{ pairs: readonly OrganizationLicensePair[] }>,
  ): Promise<number>;
}
