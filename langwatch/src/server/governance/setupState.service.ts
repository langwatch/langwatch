/**
 * GovernanceSetupStateService — read-only signals that tell the UI
 * whether an org has any governance state at all.
 *
 * Powers the persona-detection / nav-promotion logic from
 * @master_orchestrator's "don't auto-redirect, just promote when
 * state exists" direction. UI calls this on session resolve; if
 * `governanceActive` is true AND the user has organization:manage,
 * the /governance entry promotes in nav. Otherwise hide.
 *
 * Cheap by design — 5 small COUNT queries (PG) + 1 CH probe. Cached
 * client-side for the duration of the session via React Query stale-
 * time; no caching here.
 *
 * Spec: specs/ai-gateway/governance/feature-flag-gating.feature
 *       (persona detection sub-scenario, added next iter as we wire)
 */
import type { PrismaClient } from "@prisma/client";

export interface GovernanceSetupState {
  hasPersonalVKs: boolean;
  hasRoutingPolicies: boolean;
  hasIngestionSources: boolean;
  hasAnomalyRules: boolean;
  /** Any normalised activity event in the last 30 days. */
  hasRecentActivity: boolean;
  /** OR of the above — the single persona-detection signal. */
  governanceActive: boolean;
}

export class GovernanceSetupStateService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): GovernanceSetupStateService {
    return new GovernanceSetupStateService(prisma);
  }

  async resolve(organizationId: string): Promise<GovernanceSetupState> {
    // Five cheap PG counts in parallel.
    const [
      personalVkCount,
      routingPolicyCount,
      ingestionSourceCount,
      anomalyRuleCount,
    ] = await Promise.all([
      // Personal VKs — VirtualKey rows whose project is personal.
      this.countPersonalVks(organizationId),
      this.prisma.routingPolicy.count({
        where: { organizationId },
      }),
      this.prisma.ingestionSource.count({
        where: { organizationId, archivedAt: null },
      }),
      this.prisma.anomalyRule.count({
        where: { organizationId, archivedAt: null },
      }),
    ]);

    const hasRecentActivity = await this.probeRecentActivity(organizationId);

    const hasPersonalVKs = personalVkCount > 0;
    const hasRoutingPolicies = routingPolicyCount > 0;
    const hasIngestionSources = ingestionSourceCount > 0;
    const hasAnomalyRules = anomalyRuleCount > 0;

    return {
      hasPersonalVKs,
      hasRoutingPolicies,
      hasIngestionSources,
      hasAnomalyRules,
      hasRecentActivity,
      governanceActive:
        hasPersonalVKs ||
        hasRoutingPolicies ||
        hasIngestionSources ||
        hasAnomalyRules ||
        hasRecentActivity,
    };
  }

  private async countPersonalVks(organizationId: string): Promise<number> {
    // dbMultiTenancyProtection requires projectId on VirtualKey
    // queries. Resolve the org's personal projects first, then count.
    const personalProjects = await this.prisma.project.findMany({
      where: {
        team: { organizationId },
        isPersonal: true,
      },
      select: { id: true },
    });
    if (personalProjects.length === 0) return 0;
    return this.prisma.virtualKey.count({
      where: {
        projectId: { in: personalProjects.map((p) => p.id) },
        revokedAt: null,
      },
    });
  }

  private async probeRecentActivity(
    _organizationId: string,
  ): Promise<boolean> {
    // Recent-activity probe queried `gateway_activity_events` which is
    // being torn down in the unified-trace branch correction. Returns
    // false until the next commit wires the probe against
    // `trace_summaries` filtered by `langwatch.origin.kind = "ingestion_source"`
    // (or against the hidden Governance Project's recent traces, depending
    // on which lookup path is cheaper).
    return false;
  }
}
