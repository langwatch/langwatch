import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { toDate } from "@langwatch/time";

import type {
  OrganizationLicenseCandidate,
  OrganizationLicenseStorage,
  StoredLicense,
} from "../../app/licensing.members.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type OrganizationLicenseDatabase = Pick<PrismaClient, "organization">;

/** The activated licence key, read off and written onto the organization row it is stored on. */
export class PrismaOrganizationLicenseRepository implements OrganizationLicenseStorage {
  static create(database: OrganizationLicenseDatabase): PrismaOrganizationLicenseRepository {
    return new PrismaOrganizationLicenseRepository(database);
  }

  private constructor(private readonly prisma: OrganizationLicenseDatabase) {}

  async getOrganizationLicense(organizationId: string): Promise<{ licenseKey: string | null }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });
    if (organization === null) throw new OrganizationNotFoundError();
    return { licenseKey: organization.license };
  }

  // Organization carries no archive column today; when one is added, exclude it
  // here so an archived organization cannot keep an installation licensed.
  async findOrganizationsWithLicense(): Promise<OrganizationLicenseCandidate[]> {
    const organizations = await this.prisma.organization.findMany({
      where: { license: { not: null } },
      select: { id: true, license: true },
    });
    return organizations.flatMap((organization) =>
      organization.license === null
        ? []
        : [{ organizationId: organization.id, licenseKey: organization.license }],
    );
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true },
    });
    return organization !== null;
  }

  async storeLicense(organizationId: string, license: StoredLicense): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        license: license.licenseKey,
        licenseExpiresAt: toDate(license.expiresAt),
        licenseLastValidatedAt: toDate(license.validatedAt),
      },
    });
  }

  async removeLicense(organizationId: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { license: null, licenseExpiresAt: null, licenseLastValidatedAt: null },
    });
  }
}
