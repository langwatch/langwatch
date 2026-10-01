import { SsoConnectionNotFoundError } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { LegacySsoOrganizationRepository } from "../../services/sso-connection-grandfather.service.ts";

/**
 * The two string columns the grandfather migration reads
 * (`Organization.ssoDomain` / `ssoProvider`, ADR-117 §5). Read-only: the
 * columns keep deciding sign-in until connection-based routing replaces them.
 */
export class PrismaLegacySsoOrganizationRepository implements LegacySsoOrganizationRepository {
  static create(prisma: PrismaClient): PrismaLegacySsoOrganizationRepository {
    return new PrismaLegacySsoOrganizationRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {}

  async getLegacySso({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ ssoDomain: string; ssoProvider: string }> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { ssoDomain: true, ssoProvider: true },
    });
    if (!organization?.ssoDomain || !organization.ssoProvider) {
      throw new SsoConnectionNotFoundError(`${organizationId} carries no legacy SSO`);
    }
    return { ssoDomain: organization.ssoDomain, ssoProvider: organization.ssoProvider };
  }

  /**
   * The organization registered to a domain, by the same columns
   * {@link getLegacySso} reads. Not part of
   * {@link LegacySsoOrganizationRepository}; for a caller wanting the org itself.
   */
  async findByDomain({
    domain,
  }: {
    domain: string;
  }): Promise<{ id: string; name: string; ssoProvider: string | null } | null> {
    return this.prisma.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true, name: true, ssoProvider: true },
    });
  }
}
