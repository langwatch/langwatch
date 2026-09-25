import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../governance-setup-state.repository.ts";

const INTERNAL_GOVERNANCE_PROJECT_KIND = "internal_governance";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type GovernanceSetupStateDatabase = Pick<
  PrismaClient,
  "anomalyRule" | "ingestionSource" | "project" | "routingPolicy"
>;

export class PrismaGovernanceSetupStateRepository extends GovernanceSetupStateRepository {
  private constructor(private readonly prisma: GovernanceSetupStateDatabase) {
    super();
  }

  static create(database: GovernanceSetupStateDatabase): PrismaGovernanceSetupStateRepository {
    return new PrismaGovernanceSetupStateRepository(database);
  }

  async counts(organizationId: string): Promise<GovernanceSetupCounts> {
    const [routingPolicies, ingestionSources, anomalyRules, applicationProjectsWithTraces] =
      await Promise.all([
        this.prisma.routingPolicy.count({ where: { organizationId } }),
        this.prisma.ingestionSource.count({
          where: { organizationId, archivedAt: null },
        }),
        this.prisma.anomalyRule.count({
          where: { organizationId, archivedAt: null },
        }),
        this.prisma.project.count({
          where: {
            team: { organizationId },
            archivedAt: null,
            kind: { not: INTERNAL_GOVERNANCE_PROJECT_KIND },
            firstMessage: true,
          },
        }),
      ]);

    return { routingPolicies, ingestionSources, anomalyRules, applicationProjectsWithTraces };
  }
}
