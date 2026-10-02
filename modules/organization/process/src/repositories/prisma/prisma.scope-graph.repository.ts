import type { ScopeGraphOrganization } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { OrganizationScopeGraphReader } from "../../services/organization-scope-graph.service.ts";

/**
 * The scope graph in one narrow select: the skeleton and the chrome's scalars, and
 * only the caller's own membership rows. Ordered, so its hash is stable.
 */
export class PrismaScopeGraphRepository implements OrganizationScopeGraphReader {
  static create(prisma: PrismaClient): PrismaScopeGraphRepository {
    return new PrismaScopeGraphRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {}

  async findScopeGraphForUser({ userId }: { userId: string }): Promise<ScopeGraphOrganization[]> {
    const organizations = await this.prisma.organization.findMany({
      // A disabled membership must not put the organization back in the switcher.
      where: { members: { some: { userId, disabledAt: null } } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        primaryIntent: true,
        presenceEnabled: true,
        pricingModel: true,
        ssoProvider: true,
        members: { where: { userId }, select: { role: true } },
        teams: {
          where: { archivedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            slug: true,
            name: true,
            isPersonal: true,
            ownerUserId: true,
            members: { where: { userId }, select: { userId: true } },
            projects: {
              // The internal-governance project is a tenancy artifact, never user-visible
              // (specs/ai-gateway/governance/ui-contract.feature).
              where: { archivedAt: null, kind: { not: "internal_governance" } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
              select: {
                id: true,
                slug: true,
                name: true,
                userLinkTemplate: true,
                presenceEnabled: true,
                lastCodingAgentSessionAt: true,
                lastCodingAgentPullRequestAt: true,
              },
            },
          },
        },
      },
    });

    return organizations.map((organization) => ({
      ...organization,
      teams: organization.teams.map((team) => ({
        ...team,
        personalOf: team.isPersonal ? team.ownerUserId : null,
      })),
    }));
  }
}
