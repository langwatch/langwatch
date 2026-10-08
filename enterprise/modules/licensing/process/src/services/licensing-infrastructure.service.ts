import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ServerRole } from "@langwatch/process";

import type { LicensingInfrastructure } from "../app/licensing.app.ts";
import type {
  OrganizationLicenseReads,
  OrganizationLicenseRepository,
} from "../repositories/organization-license.repository.ts";

/** The licence writes, which organization owns (`licenseLastValidatedAt` stamped by the caller). */
type LicenseWrites = Pick<OrganizationApi, "setLicense" | "clearLicense">;

type SeatCounts = Readonly<{
  getMemberCount: (organizationId: string) => Promise<number>;
  getMembersLiteCount: (organizationId: string) => Promise<number>;
}>;

/**
 * The licence rows and the seat counts behind them. A composition that holds
 * the rows but no mutation still scans them, and refuses each mutation by the
 * role it runs in, never a silent "no licenses".
 */
export class LicensingInfrastructureService {
  static create({ role }: { role: ServerRole | undefined }): LicensingInfrastructureService {
    return new LicensingInfrastructureService(role === undefined ? "this process" : `the ${role}`);
  }

  private constructor(private readonly composer: string) {}

  /** The licence reads alone: every mutation refuses by role. */
  withoutMutation(
    options: Readonly<{ licenses: OrganizationLicenseReads }> & SeatCounts,
  ): LicensingInfrastructure {
    const unavailable = () => new Error(`${this.composer} does not compose license mutation`);
    return this.withStorage({
      ...options,
      licenses: {
        getOrganizationLicense: (organizationId) =>
          options.licenses.getOrganizationLicense(organizationId),
        findOrganizationsWithLicense: () => options.licenses.findOrganizationsWithLicense(),
        organizationExists: () => Promise.reject(unavailable()),
      },
      organizations: {
        setLicense: () => Promise.reject(unavailable()),
        clearLicense: () => Promise.reject(unavailable()),
      },
    });
  }

  /** The licence rows read here and written through organization, with its seat counts. */
  withStorage(
    options: Readonly<{ licenses: OrganizationLicenseRepository; organizations: LicenseWrites }> &
      SeatCounts,
  ): LicensingInfrastructure {
    const { licenses, organizations } = options;
    return {
      repository: {
        getOrganizationLicense: (organizationId) => licenses.getOrganizationLicense(organizationId),
        findOrganizationsWithLicense: () => licenses.findOrganizationsWithLicense(),
        organizationExists: (organizationId) => licenses.organizationExists(organizationId),
        storeLicense: (organizationId, { licenseKey, expiresAt, validatedAt }) =>
          organizations.setLicense({ organizationId, licenseKey, expiresAt, validatedAt }),
        removeLicense: (organizationId) => organizations.clearLicense({ organizationId }),
        getMemberCount: (organizationId) => options.getMemberCount(organizationId),
        getMembersLiteCount: (organizationId) => options.getMembersLiteCount(organizationId),
      },
      configuredAuthProvider: () => null,
      platformSsoAllowed: () => Promise.resolve(false),
      authProviderIsMounted: () => false,
      reportSigningFailure: () => void 0,
    };
  }
}
