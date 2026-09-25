import type { PrismaClient } from "@langwatch/prisma-client/generated";

import {
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../governance-setup-state.repository.ts";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type GovernanceSetupStateDatabase = Pick<
  PrismaClient,
  "anomalyRule" | "ingestionSource" | "routingPolicy"
>;

export class PrismaGovernanceSetupStateRepository extends GovernanceSetupStateRepository {
  private constructor(private readonly prisma: GovernanceSetupStateDatabase) {
    super();
  }

  static create(database: GovernanceSetupStateDatabase): PrismaGovernanceSetupStateRepository {
    return new PrismaGovernanceSetupStateRepository(database);
  }

  async counts(organizationId: string): Promise<GovernanceSetupCounts> {
    const [routingPolicies, ingestionSources, anomalyRules] = await Promise.all([
      this.prisma.routingPolicy.count({ where: { organizationId } }),
      this.prisma.ingestionSource.count({ where: { organizationId, archivedAt: null } }),
      this.prisma.anomalyRule.count({ where: { organizationId, archivedAt: null } }),
    ]);

    return { routingPolicies, ingestionSources, anomalyRules };
  }
}
