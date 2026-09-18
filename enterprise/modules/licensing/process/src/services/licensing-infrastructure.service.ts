import type { LicensingInfrastructure } from "../app/licensing.app.ts";
import type { LicenseStorage, OrganizationLicense } from "../app/licensing.members.ts";
import {
  PrismaOrganizationLicenseRepository,
  type OrganizationLicenseDatabase,
} from "../repositories/prisma/prisma.organization-license.repository.ts";

/** The licence rows this deployment stores, over its own connection. */
export function createOrganizationLicenses(
  database: OrganizationLicenseDatabase,
): OrganizationLicense {
  return PrismaOrganizationLicenseRepository.create(database);
}

/** The live license read plus explicit refusals for write/enforcement ports not composed here. */
export function createUnavailableLicensingInfrastructure(options: {
  database: OrganizationLicenseDatabase;
  processName: string;
}): LicensingInfrastructure {
  const licenses = createOrganizationLicenses(options.database);
  const unavailable = () => new Error(`${options.processName} does not compose license mutation`);
  const repository: LicenseStorage = {
    tryReadLicense: (organizationId) => licenses.tryReadLicense(organizationId),
    findOrganizationsWithLicense: () => Promise.reject(unavailable()),
    organizationExists: () => Promise.reject(unavailable()),
    storeLicense: () => Promise.reject(unavailable()),
    removeLicense: () => Promise.reject(unavailable()),
    getMemberCount: () => Promise.reject(unavailable()),
    getMembersLiteCount: () => Promise.reject(unavailable()),
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
