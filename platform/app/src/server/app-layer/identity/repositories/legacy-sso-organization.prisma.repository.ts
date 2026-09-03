import type { LegacySsoOrganizationRepository } from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";

/**
 * The two string columns the grandfather migration reads
 * (`Organization.ssoDomain` / `ssoProvider`, ADR-027 §Context). An
 * organization holding one without the other is not configured for SSO — the
 * legacy matcher needs both to route — so it is not something to grandfather.
 *
 * Read-only, deliberately. This slice stops no string write: the columns keep
 * being written and keep deciding sign-in until that organization reaches
 * `enforce`, which is what makes the rollback "flag off" rather than "restore
 * the data".
 */
export class PrismaLegacySsoOrganizationRepository
  implements LegacySsoOrganizationRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findLegacySso({
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

  /**
   * The organization that claims a domain through the legacy column.
   *
   * The other direction of the same pair, for the born-finalized entrance
   * (ADR-116 §3): it holds an address and needs the organization a targeting
   * rule can name. `ssoDomain` is unique, so there is one answer or none.
   */
  async findByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ id: string } | null> {
    return await this.prisma.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true },
    });
  }
}
