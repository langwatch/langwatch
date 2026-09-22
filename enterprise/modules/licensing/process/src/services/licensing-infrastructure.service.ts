import type { LicensingInfrastructure } from "../app/licensing.app.ts";
import type { LicenseStorage, OrganizationLicenseReads } from "../app/licensing.members.ts";
import {
  PrismaOrganizationLicenseRepository,
  type OrganizationLicenseDatabase,
} from "../repositories/prisma/prisma.organization-license.repository.ts";

/** The licence rows this deployment stores, over its own connection. */
export function createOrganizationLicenses(
  database: OrganizationLicenseDatabase,
): OrganizationLicenseReads {
  return PrismaOrganizationLicenseRepository.create(database);
}

/**
 * The live licence reads, plus explicit refusals for write/enforcement ports not composed here.
 * Seat counts are a peer module's own repository, so this service never reaches for them itself -
 * the caller (the app's own composition) may supply real ones; unsupplied, they refuse too.
 */
export function createUnavailableLicensingInfrastructure(options: {
  licenses: OrganizationLicenseReads;
  processName: string;
  getMemberCount?: (organizationId: string) => Promise<number>;
  getMembersLiteCount?: (organizationId: string) => Promise<number>;
}): LicensingInfrastructure {
  const licenses = options.licenses;
  const unavailable = () => new Error(`${options.processName} does not compose license mutation`);
  const repository: LicenseStorage = {
    tryReadLicense: (organizationId) => licenses.tryReadLicense(organizationId),
    findOrganizationsWithLicense: () => licenses.findOrganizationsWithLicense(),
    organizationExists: () => Promise.reject(unavailable()),
    storeLicense: () => Promise.reject(unavailable()),
    removeLicense: () => Promise.reject(unavailable()),
    getMemberCount: options.getMemberCount ?? (() => Promise.reject(unavailable())),
    getMembersLiteCount: options.getMembersLiteCount ?? (() => Promise.reject(unavailable())),
  };
  return {
    repository,
    configuredAuthProvider: () => null,
    platformSsoAllowed: () => Promise.resolve(false),
    authProviderIsMounted: () => false,
    reportSigningFailure: () => void 0,
    checkLimit: () => Promise.reject(unavailable()),
    notifyLimitReached: () => Promise.reject(unavailable()),
    reportError: () => void 0,
  };
}
