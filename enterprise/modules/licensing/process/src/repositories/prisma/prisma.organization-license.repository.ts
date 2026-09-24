import { OrganizationNotFoundError } from "@langwatch/enterprise-licensing-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  OrganizationLicenseCandidate,
  OrganizationLicenseReads,
} from "../../app/licensing.members.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type OrganizationLicenseDatabase = Pick<PrismaClient, "organization">;

/** The activated licence key, read off the organization row it is stored on. */
export class PrismaOrganizationLicenseRepository implements OrganizationLicenseReads {
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
}
