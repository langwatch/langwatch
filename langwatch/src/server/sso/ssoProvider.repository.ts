import {
  Prisma,
  type OrganizationUserRole,
  type PrismaClient,
  type SsoProvider,
} from "@prisma/client";
import { SsoProviderNotFoundError } from "./errors";

/**
 * Persistence for SsoProvider rows. The `oidcConfig` / `samlConfig` JSON blobs
 * are encrypted at rest transparently by the Prisma middleware in
 * src/utils/dbSsoProviderSecretEncryption — this repository always sees and
 * returns plaintext JSON strings.
 *
 * Org tenancy is enforced here (every management query is constrained to one
 * organizationId), since SsoProvider is exempt from the org-id DB guard: the
 * @better-auth/sso plugin routes login by `domain` with unbounded reads, which
 * the guard would reject.
 */
export class SsoProviderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): SsoProviderRepository {
    return new SsoProviderRepository(prisma);
  }

  async findById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<SsoProvider | null> {
    return this.prisma.ssoProvider.findFirst({
      where: { id, organizationId },
    });
  }

  async findByProviderId({
    providerId,
  }: {
    providerId: string;
  }): Promise<SsoProvider | null> {
    return this.prisma.ssoProvider.findUnique({
      where: { providerId },
    });
  }

  async findEnforcedByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ organizationId: string } | null> {
    const provider = await this.prisma.ssoProvider.findFirst({
      where: { domain, ssoEnforced: true, domainVerified: true },
      select: { organizationId: true },
    });
    if (!provider?.organizationId) return null;
    return { organizationId: provider.organizationId };
  }

  async findAllByOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoProvider[]> {
    return this.prisma.ssoProvider.findMany({
      where: { organizationId },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: {
    organizationId: string;
    userId: string | null;
    providerId: string;
    issuer: string;
    domain: string;
    oidcConfig: string | null;
    samlConfig: string | null;
    ssoEnforced: boolean;
    jitProvisioning: boolean;
    defaultOrgRole: OrganizationUserRole;
    roleMapping: Record<string, unknown> | null;
  }): Promise<SsoProvider> {
    return this.prisma.ssoProvider.create({
      data: {
        organizationId: data.organizationId,
        userId: data.userId,
        providerId: data.providerId,
        issuer: data.issuer,
        domain: data.domain,
        oidcConfig: data.oidcConfig,
        samlConfig: data.samlConfig,
        ssoEnforced: data.ssoEnforced,
        jitProvisioning: data.jitProvisioning,
        defaultOrgRole: data.defaultOrgRole,
        roleMapping: (data.roleMapping ?? undefined) as
          | Prisma.InputJsonValue
          | undefined,
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
      issuer?: string;
      oidcConfig?: string | null;
      samlConfig?: string | null;
      domainVerified?: boolean;
      ssoEnforced?: boolean;
      jitProvisioning?: boolean;
      defaultOrgRole?: OrganizationUserRole;
      roleMapping?: Record<string, unknown> | null;
    };
  }): Promise<SsoProvider> {
    const { roleMapping, ...rest } = data;
    const prismaData: Prisma.SsoProviderUncheckedUpdateInput = { ...rest };

    if (roleMapping !== undefined) {
      prismaData.roleMapping =
        roleMapping === null
          ? Prisma.JsonNull
          : (roleMapping as Prisma.InputJsonValue);
    }

    try {
      // The composite where bounds the update to one org so a caller cannot
      // touch another tenant's provider by id alone.
      const result = await this.prisma.ssoProvider.updateMany({
        where: { id, organizationId },
        data: prismaData,
      });
      if (result.count === 0) throw new SsoProviderNotFoundError(id);
      return (await this.findById({ id, organizationId }))!;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        throw new SsoProviderNotFoundError(id);
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
    const result = await this.prisma.ssoProvider.deleteMany({
      where: { id, organizationId },
    });
    if (result.count === 0) throw new SsoProviderNotFoundError(id);
  }
}
