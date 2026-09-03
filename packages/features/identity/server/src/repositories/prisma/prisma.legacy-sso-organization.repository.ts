import type { LegacySsoOrganizationRepository } from "../../sso-connection-grandfather.service";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

/**
 * The two string columns the grandfather migration reads
 * (`Organization.ssoDomain` / `ssoProvider`, ADR-027 §Context). An
 * organization holding one without the other is not configured for SSO — the
 * legacy matcher needs both to route — so it is not something to grandfather.
 *
 * Read-only, deliberately. This slice stops no string write: the columns keep
 * being written and keep deciding sign-in until `SSOCONN_ROUTING` reaches
 * `enforce`, which is what makes the rollback "flag off" rather than "restore
 * the data".
 */
export class PrismaLegacySsoOrganizationRepository
  implements LegacySsoOrganizationRepository
{
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
