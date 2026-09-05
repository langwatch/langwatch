import type { LegacySsoOrganizationRepository } from "../../services/sso-connection-grandfather.service";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The two string columns the grandfather migration reads organization holding one without the other
 * is not configured for SSO — the legacy matcher needs both to route — so it is not something to
 * (`Organization.ssoDomain` / `ssoProvider`, ADR-027 §Context). An
 */
export class PrismaLegacySsoOrganizationRepository implements LegacySsoOrganizationRepository {
  static create(prisma: PrismaClient): PrismaLegacySsoOrganizationRepository {
    return new PrismaLegacySsoOrganizationRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async tryFindLegacySso({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ ssoDomain: string; ssoProvider: string } | null> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ssoDomain: true, ssoProvider: true },
    });
    if (!organization?.ssoDomain || !organization.ssoProvider) return null;
    return {
      ssoDomain: organization.ssoDomain,
      ssoProvider: organization.ssoProvider,
    };
  }
}
