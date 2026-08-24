export type StoredLicense = {
  licenseKey: string;
  expiresAt: Date;
  validatedAt: Date;
};

/** Persistence and seat-count port. Concrete database adapters stay in apps. */
export abstract class LicenseRepository {
  abstract readLicense(organizationId: string): Promise<string | null>;
  abstract organizationExists(organizationId: string): Promise<boolean>;
  abstract storeLicense(
    organizationId: string,
    license: StoredLicense,
  ): Promise<void>;
  abstract removeLicense(organizationId: string): Promise<void>;
  abstract getMemberCount(organizationId: string): Promise<number>;
  abstract getMembersLiteCount(organizationId: string): Promise<number>;
}
