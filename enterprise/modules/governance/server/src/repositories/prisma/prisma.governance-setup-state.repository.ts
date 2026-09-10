import type { PrismaClient } from "@langwatch/prisma-client/generated";
import {
  GovernanceSetupStateRepository,
  type GovernanceSetupCounts,
} from "../audit/governance-setup-state.repository.ts";

const INTERNAL_GOVERNANCE_PROJECT_KIND = "internal_governance";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type GovernanceSetupStateDatabase = Pick<
  PrismaClient,
  "anomalyRule" | "ingestionSource" | "project" | "routingPolicy" | "virtualKey"
>;

export class PrismaGovernanceSetupStateRepository extends GovernanceSetupStateRepository {
  private constructor(private readonly prisma: GovernanceSetupStateDatabase) {
    super();
  }

  static create(database: GovernanceSetupStateDatabase): PrismaGovernanceSetupStateRepository {
    return new PrismaGovernanceSetupStateRepository(database);
  }

  async counts(organizationId: string): Promise<GovernanceSetupCounts> {
    const [
      personalVirtualKeys,
      routingPolicies,
      ingestionSources,
      anomalyRules,
      applicationProjectsWithTraces,
      governanceProject,
    ] = await Promise.all([
      this.prisma.virtualKey.count({
        where: {
          organizationId,
          principalUserId: { not: null },
          revokedAt: null,
        },
      }),
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
      this.prisma.project.findFirst({
        where: {
          kind: INTERNAL_GOVERNANCE_PROJECT_KIND,
          team: { organizationId },
          archivedAt: null,
        },
        select: { id: true },
      }),
    ]);

    return {
      personalVirtualKeys,
      routingPolicies,
      ingestionSources,
      anomalyRules,
      applicationProjectsWithTraces,
      governanceTenantId: governanceProject?.id ?? null,
    };
  }
}
