import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { OrganizationLicensePort } from "../../ports/organization-license.port";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type OrganizationLicenseDatabase = Pick<PrismaClient, "organization">;

/** The activated licence key, read off the organization row it is stored on. */
export class PrismaOrganizationLicenseRepository extends OrganizationLicensePort {
  static create(database: OrganizationLicenseDatabase): PrismaOrganizationLicenseRepository {
    return new PrismaOrganizationLicenseRepository(database);
  }

  private constructor(private readonly prisma: OrganizationLicenseDatabase) {
    super();
  }

  async tryReadLicense(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });
    return organization?.license ?? null;
  }
}
