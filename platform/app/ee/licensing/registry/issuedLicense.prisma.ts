/**
 * Prisma bindings for the license registry (ADR-139). The services are built
 * in `./composition.ts`.
 */

import { nanoid } from "nanoid";
import type { Prisma, PrismaClient } from "~/generated/prisma/client";
import { slugify } from "~/utils/slugify";
import type {
  CustomerOrganizationPort,
  IssuedLicenseRecord,
  IssuedLicenseRepository,
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

  async findByVirtualKeyId(
    virtualKeyId: string,
  ): Promise<IssuedLicenseRecord | null> {
    return this.prisma.issuedLicense.findUnique({ where: { virtualKeyId } });
  }

  async findAllByOrganization(
    organizationId: string,
  ): Promise<IssuedLicenseRecord[]> {
    return this.prisma.issuedLicense.findMany({ where: { organizationId } });
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

  async bindInstance({
    id,
    instanceId,
    at,
  }: {
    id: string;
    instanceId: string;
    at: Date;
  }): Promise<boolean> {
    // One conditional write, so the database decides which install wins.
    const { count } = await this.prisma.issuedLicense.updateMany({
      where: { id, instanceId: null },
      data: { instanceId, instanceBoundAt: at },
    });
    return count === 1;
  }

  async attachVirtualKey({
    id,
    virtualKeyId,
  }: {
    id: string;
    virtualKeyId: string;
  }): Promise<boolean> {
    const { count } = await this.prisma.issuedLicense.updateMany({
      where: { id, virtualKeyId: null },
      data: { virtualKeyId },
    });
    return count === 1;
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
