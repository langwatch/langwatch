import { Prisma, type PrismaClient, type SsoConnection } from "@prisma/client";
import { SsoConnectionNotFoundError } from "./errors";

export class SsoConnectionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): SsoConnectionRepository {
    return new SsoConnectionRepository(prisma);
  }

  async findById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<SsoConnection | null> {
    return this.prisma.ssoConnection.findFirst({
      where: { id, organizationId },
    });
  }

  async findByDomain({
    domain,
    organizationId,
  }: {
    domain: string;
    organizationId: string;
  }): Promise<SsoConnection | null> {
    return this.prisma.ssoConnection.findFirst({
      where: { domain, organizationId },
    });
  }

  async findVerifiedByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<SsoConnection | null> {
    return this.prisma.ssoConnection.findFirst({
      where: { domain, verifiedAt: { not: null } },
    });
  }

  async findEnforcedByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ organizationId: string } | null> {
    return this.prisma.ssoConnection.findFirst({
      where: { domain, ssoEnforced: true, verifiedAt: { not: null } },
      select: { organizationId: true },
    });
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnection[]> {
    return this.prisma.ssoConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create({
    organizationId,
    domain,
    provider,
    clientId,
    clientSecretEnc,
    issuerUrl,
    tenantId,
    samlEntityId,
    samlSsoUrl,
    samlCertificate,
    attributeMapping,
    roleMapping,
    ssoEnforced,
    jitProvisioning,
    defaultOrgRole,
  }: {
    organizationId: string;
    domain: string;
    provider: string;
    clientId?: string | null;
    clientSecretEnc?: string | null;
    issuerUrl?: string | null;
    tenantId?: string | null;
    samlEntityId?: string | null;
    samlSsoUrl?: string | null;
    samlCertificate?: string | null;
    attributeMapping?: Record<string, unknown> | null;
    roleMapping?: Record<string, unknown> | null;
    ssoEnforced?: boolean;
    jitProvisioning?: boolean;
    defaultOrgRole?: "ADMIN" | "MEMBER" | "EXTERNAL";
  }): Promise<SsoConnection> {
    return this.prisma.ssoConnection.create({
      data: {
        organizationId,
        domain,
        provider,
        clientId,
        clientSecretEnc,
        issuerUrl,
        tenantId,
        samlEntityId,
        samlSsoUrl,
        samlCertificate,
        attributeMapping: (attributeMapping ?? undefined) as Prisma.InputJsonValue | undefined,
        roleMapping: (roleMapping ?? undefined) as Prisma.InputJsonValue | undefined,
        ssoEnforced: ssoEnforced ?? false,
        jitProvisioning: jitProvisioning ?? false,
        defaultOrgRole: defaultOrgRole ?? "MEMBER",
      },
    });
  }

  async update({
    id,
    organizationId,
    data,
  }: {
    id: string;
    organizationId: string;
    data: {
      provider?: string;
      clientId?: string | null;
      clientSecretEnc?: string | null;
      issuerUrl?: string | null;
      tenantId?: string | null;
      samlEntityId?: string | null;
      samlSsoUrl?: string | null;
      samlCertificate?: string | null;
      attributeMapping?: Record<string, unknown> | null;
      roleMapping?: Record<string, unknown> | null;
      ssoEnforced?: boolean;
      jitProvisioning?: boolean;
      defaultOrgRole?: "ADMIN" | "MEMBER" | "EXTERNAL";
      verifiedAt?: Date | null;
    };
  }): Promise<SsoConnection> {
    const { attributeMapping, roleMapping, ...rest } = data;
    const prismaData: Prisma.SsoConnectionUncheckedUpdateInput = { ...rest };

    if (attributeMapping !== undefined) {
      prismaData.attributeMapping =
        attributeMapping === null
          ? Prisma.JsonNull
          : (attributeMapping as Prisma.InputJsonValue);
    }
    if (roleMapping !== undefined) {
      prismaData.roleMapping =
        roleMapping === null
          ? Prisma.JsonNull
          : (roleMapping as Prisma.InputJsonValue);
    }

    try {
      return await this.prisma.ssoConnection.update({
        where: { id, organizationId },
        data: prismaData,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new SsoConnectionNotFoundError(id);
      }
      throw err;
    }
  }

  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    try {
      await this.prisma.ssoConnection.delete({
        where: { id, organizationId },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
        throw new SsoConnectionNotFoundError(id);
      }
      throw err;
    }
  }
}
