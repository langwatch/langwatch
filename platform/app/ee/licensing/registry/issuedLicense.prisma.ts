/**
 * Prisma bindings for the license registry, and the one place that builds the
 * service with the server's signing key (ADR-139).
 */

import { nanoid } from "nanoid";
import { env } from "~/env.mjs";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { encrypt } from "~/utils/encryption";
import { slugify } from "~/utils/slugify";
import { PUBLIC_KEY } from "../constants";
import {
  type CustomerOrganizationPort,
  type IssuedLicenseRecord,
  type IssuedLicenseRepository,
  LicenseRegistryService,
} from "./licenseRegistry.service";

export class PrismaIssuedLicenseRepository implements IssuedLicenseRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    data: Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<IssuedLicenseRecord> {
    return this.prisma.issuedLicense.create({ data });
  }

  async findById(id: string): Promise<IssuedLicenseRecord | null> {
    return this.prisma.issuedLicense.findUnique({ where: { id } });
  }

  async findByTokenHash(
    tokenHash: string,
  ): Promise<IssuedLicenseRecord | null> {
    return this.prisma.issuedLicense.findUnique({ where: { tokenHash } });
  }

  async findAll({
    page,
    pageSize,
    search,
  }: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ rows: IssuedLicenseRecord[]; total: number }> {
    const term = search?.trim();
    const where: Prisma.IssuedLicenseWhereInput = term
      ? {
          OR: [
            { organizationName: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
            { licenseId: { contains: term, mode: "insensitive" } },
          ],
        }
      : {};
    const [rows, total] = await Promise.all([
      this.prisma.issuedLicense.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: page * pageSize,
        take: pageSize,
      }),
      this.prisma.issuedLicense.count({ where }),
    ]);
    return { rows, total };
  }

  async update(
    id: string,
    data: Partial<Omit<IssuedLicenseRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<IssuedLicenseRecord> {
    return this.prisma.issuedLicense.update({ where: { id }, data });
  }
}

export class PrismaCustomerOrganizations implements CustomerOrganizationPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<{ id: string; name: string } | null> {
    return this.prisma.organization.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
  }

  /**
   * A customer organization for a self-hosted customer has no LangWatch Cloud
   * users, so it is created bare. The suffix keeps the slug unique when two
   * customers share a name.
   */
  async createSelfHostedCustomer({
    name,
  }: {
    name: string;
  }): Promise<{ id: string; name: string }> {
    return this.prisma.organization.create({
      data: {
        name,
        slug: `${slugify(name) || "customer"}-${nanoid(6).toLowerCase()}`,
        selfHostedCustomer: true,
      },
      select: { id: true, name: true },
    });
  }

  async markSelfHostedCustomer(id: string): Promise<void> {
    await this.prisma.organization.update({
      where: { id },
      data: { selfHostedCustomer: true },
    });
  }
}

/** The registry as the app uses it: Prisma, the server's signing key, real encryption. */
export function createLicenseRegistryService(
  prisma: PrismaClient,
): LicenseRegistryService {
  return new LicenseRegistryService({
    repository: new PrismaIssuedLicenseRepository(prisma),
    organizations: new PrismaCustomerOrganizations(prisma),
    // Read per call, so a rotated secret needs no rebuild of the service.
    signingKey: () => env.LANGWATCH_LICENSE_PRIVATE_KEY,
    publicKey: PUBLIC_KEY,
    encrypt,
  });
}
