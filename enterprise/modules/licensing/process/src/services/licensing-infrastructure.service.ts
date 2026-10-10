import type { ServerRole } from "@langwatch/process";

import type { LicensingInfrastructure } from "../app/licensing.app.ts";
import type {
  OrganizationLicenseReads,
  OrganizationLicenseRepository,
} from "../repositories/organization-license.repository.ts";
import type { LicensingCustomerFactsService } from "./licensing-customer-facts.service.ts";
import { OrganizationLicenseWriterService } from "./organization-license-writer.service.ts";

/** The facts organization mirrors its licence columns from (C3-FACT-FIRST). */
type LicenseFacts = Pick<LicensingCustomerFactsService, "licenseStored" | "licenseCleared">;

type LicenseRows = OrganizationLicenseReads &
  Pick<
    OrganizationLicenseRepository,
    "organizationExists" | "findLicense" | "saveLicense" | "clearLicense" | "restoreLicense"
  >;

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
        findLicense: () => Promise.reject(unavailable()),
        saveLicense: () => Promise.reject(unavailable()),
        clearLicense: () => Promise.reject(unavailable()),
        restoreLicense: () => Promise.reject(unavailable()),
      },
      facts: {
        licenseStored: () => Promise.reject(unavailable()),
        licenseCleared: () => Promise.reject(unavailable()),
      },
    });
  }

  /** The licence rows read and written here, each write recorded as a fact, with seat counts. */
  withStorage(
    options: Readonly<{ licenses: LicenseRows; facts: LicenseFacts }> & SeatCounts,
  ): LicensingInfrastructure {
    const { licenses, facts } = options;
    const writer = OrganizationLicenseWriterService.create({ licenses, facts });
    return {
      repository: {
        getOrganizationLicense: (organizationId) => licenses.getOrganizationLicense(organizationId),
        findOrganizationsWithLicense: () => licenses.findOrganizationsWithLicense(),
        organizationExists: (organizationId) => licenses.organizationExists(organizationId),
        storeLicense: (organizationId, license) => writer.store({ organizationId, license }),
        removeLicense: (organizationId) => writer.remove({ organizationId }),
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
