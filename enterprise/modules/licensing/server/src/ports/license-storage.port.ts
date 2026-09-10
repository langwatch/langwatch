import { OrganizationLicense } from "../app/licensing.infrastructure.ts";
import type { Instant } from "@langwatch/time";

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
 * Persistence and seat-count port. Concrete database adapters stay in apps,
 * except the one read plan resolution makes: `tryReadLicense` is inherited
 * from {@link OrganizationLicense} so a process that only resolves plans
 * can compose that read alone, without the seat counts this port also carries.
 */
export abstract class LicenseStoragePort implements OrganizationLicense {
  abstract findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]>;
  abstract organizationExists(organizationId: string): Promise<boolean>;
  abstract storeLicense(organizationId: string, license: StoredLicense): Promise<void>;
  abstract removeLicense(organizationId: string): Promise<void>;
  abstract getMemberCount(organizationId: string): Promise<number>;
  abstract getMembersLiteCount(organizationId: string): Promise<number>;
}
