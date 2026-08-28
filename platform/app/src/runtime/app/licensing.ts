import { DEFAULT_LICENSE_PUBLIC_KEY } from "@langwatch/enterprise-licensing-contract";
import {
  LicenseStoragePort,
  LicenseRetentionPort,
  LicenseService,
  LicenseServiceConfiguration,
  LicenseUsagePort,
  NodeLicenseCryptographyAdapter,
  type StoredLicense,
} from "@langwatch/enterprise-licensing-server";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import {
  PLATFORM_DEFAULT_RETENTION_DAYS,
  RETENTION_CATEGORIES,
  retentionCategorySchema,
} from "~/server/data-retention/retentionPolicy.schema";
import { prisma } from "~/server/db";
import { LicenseEnforcementRepository } from "~/server/license-enforcement/license-enforcement.repository";

export * from "@langwatch/enterprise-licensing-server";

class PrismaLicenseRepository extends LicenseStoragePort {
  private readonly counts: LicenseEnforcementRepository;

  constructor(private readonly prismaClient: PrismaClient) {
    super();
    this.counts = new LicenseEnforcementRepository(prismaClient);
  }

  async findOrganizationsWithLicense() {
    const organizations = await this.prismaClient.organization.findMany({
      where: { license: { not: null } },
      select: { id: true, license: true },
    });
    return organizations.flatMap((organization) =>
      organization.license
        ? [
            {
              organizationId: organization.id,
              licenseKey: organization.license,
            },
          ]
        : [],
    );
  }

  async readLicense(organizationId: string): Promise<string | null> {
    const organization = await this.prismaClient.organization.findUnique({
      where: { id: organizationId },
      select: { license: true },
    });
    return organization?.license ?? null;
  }

  async organizationExists(organizationId: string): Promise<boolean> {
    return (
      (await this.prismaClient.organization.findUnique({
        where: { id: organizationId },
        select: { id: true },
      })) !== null
    );
  }

  async storeLicense(organizationId: string, license: StoredLicense): Promise<void> {
    await this.prismaClient.organization.update({
      where: { id: organizationId },
      data: {
        license: license.licenseKey,
        licenseExpiresAt: license.expiresAt,
        licenseLastValidatedAt: license.validatedAt,
      },
    });
  }

  async removeLicense(organizationId: string): Promise<void> {
    await this.prismaClient.organization.update({
      where: { id: organizationId },
      data: {
        license: null,
        licenseExpiresAt: null,
        licenseLastValidatedAt: null,
      },
    });
  }

  getMemberCount(organizationId: string): Promise<number> {
    return this.counts.getMemberCount(organizationId);
  }

  getMembersLiteCount(organizationId: string): Promise<number> {
    return this.counts.getMembersLiteCount(organizationId);
  }
}

class AppLicenseUsage extends LicenseUsagePort {
  getCurrentMonthCount(input: { organizationId: string }) {
    return getApp().usage.getCurrentMonthCount(input);
  }
}

class AppLicenseRetention extends LicenseRetentionPort {
  listOrganizationRules(organizationId: string) {
    return getApp().dataRetention.listOrganizationRules({ organizationId });
  }

  async setForOrganization(input: {
    organizationId: string;
    category: string;
    retentionDays: number;
  }): Promise<void> {
    await getApp().dataRetention.setForScope({
      scope: {
        scopeType: "ORGANIZATION",
        scopeId: input.organizationId,
      },
      category: retentionCategorySchema.parse(input.category),
      retentionDays: input.retentionDays,
    });
  }
}

let licenseHandler: LicenseService | null = null;
let licenseCryptography: NodeLicenseCryptographyAdapter | null = null;

/** Process-owned cryptography adapter shared by license reads and minting. */
export function getLicenseCryptography(): NodeLicenseCryptographyAdapter {
  if (!licenseCryptography) {
    const publicKey =
      process.env.LANGWATCH_LICENSE_PUBLIC_KEY ?? DEFAULT_LICENSE_PUBLIC_KEY;
    licenseCryptography = NodeLicenseCryptographyAdapter.create({ publicKey });
  }
  return licenseCryptography;
}

/** Legacy app accessor while runtime composition is extracted. */
export function getLicenseHandler(): LicenseService {
  if (!licenseHandler) {
    licenseHandler = LicenseService.create({
      repository: new PrismaLicenseRepository(prisma),
      cryptography: getLicenseCryptography(),
      usage: new AppLicenseUsage(),
      retention: new AppLicenseRetention(),
      logger: createLogger("langwatch:licensing:license-service"),
      configuration: LicenseServiceConfiguration.create({
        retention: {
          categories: RETENTION_CATEGORIES,
          defaultDays: PLATFORM_DEFAULT_RETENTION_DAYS,
        },
      }),
    });
  }
  return licenseHandler;
}
