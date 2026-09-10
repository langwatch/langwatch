import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { OrganizationLicense } from "../../app/licensing.infrastructure.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type OrganizationLicenseDatabase = Pick<PrismaClient, "organization">;

/** The activated licence key, read off the organization row it is stored on. */
export class PrismaOrganizationLicenseRepository implements OrganizationLicense {
  static create(database: OrganizationLicenseDatabase): PrismaOrganizationLicenseRepository {
    return new PrismaOrganizationLicenseRepository(database);
  }

  private constructor(private readonly prisma: OrganizationLicenseDatabase) {
  }

  async tryReadLicense(organizationId: string): Promise<string | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });
    return organization?.license ?? null;
  }
}
