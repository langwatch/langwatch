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
   * The organization that claims a domain through the legacy `ssoDomain`
   * column — the ONE place that lookup is spelled.
   *
   * It was spelled four times, and the copies had already started to differ
   * in what they selected. `ssoProvider` comes back with the row because
   * every caller that has the domain then asks whether the provider matches,
   * and `name` because the one that auto-joins announces it.
   *
   * Unlike `findLegacySso` above, an organization with a domain and no
   * provider is still answered: enforcement asks about the provider
   * separately, and swallowing the row here would silently turn a
   * half-configured organization into no organization at all.
   */
  async findByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null> {
    return await this.prisma.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true, name: true, ssoProvider: true },
    });
  }
}
