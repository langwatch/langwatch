import { SsoConnectionNotFoundError } from "@langwatch/identity-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  type LegacySsoOrganization,
  LegacySsoOrganizationRepository,
} from "../legacy-sso-organization.repository.ts";

/**
 * The two string columns the grandfather migration reads
 * (`Organization.ssoDomain` / `ssoProvider`, ADR-117 §5). Read-only: the
 * columns keep deciding sign-in until connection-based routing replaces them.
 */
export class PrismaLegacySsoOrganizationRepository extends LegacySsoOrganizationRepository {
  static create(prisma: PrismaClient): PrismaLegacySsoOrganizationRepository {
    return new PrismaLegacySsoOrganizationRepository(prisma);
  }

  constructor(private readonly prisma: PrismaClient) {
    super();
  }

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

  async findByDomain({ domain }: { domain: string }): Promise<LegacySsoOrganization | null> {
    return this.prisma.organization.findUnique({
      where: { ssoDomain: domain },
      select: { id: true, name: true, ssoProvider: true },
    });
  }
}
