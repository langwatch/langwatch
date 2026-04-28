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

import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { PROJECT_KIND } from "./governanceProject.service";

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

  /**
   * Probes whether any governance-origin trace or log_record has landed
   * in the last 30 days for the org's hidden Governance Project. Used by
   * the persona-detection nav-promotion logic so /governance shows up
   * even if no IngestionSource / AnomalyRule definitions exist yet but
   * traces are flowing.
   *
   * Returns false (and short-circuits before the CH query) when the org
   * has no Gov Project yet — no governance-origin traffic is possible
   * before the first IngestionSource is minted.
   */
  private async probeRecentActivity(
    organizationId: string,
  ): Promise<boolean> {
    const govProject = await this.prisma.project.findFirst({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        team: { organizationId },
        archivedAt: null,
      },
      select: { id: true },
    });
    if (!govProject) return false;

    const ch = await getClickHouseClientForOrganization(organizationId);
    if (!ch) return false;

    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = await ch.query({
      query: `
        SELECT 1 AS hit
        FROM trace_summaries ts
        WHERE ts.TenantId = {tenantId:String}
          AND ts.OccurredAt >= fromUnixTimestamp64Milli({since:UInt64})
          AND ts.Attributes['langwatch.origin.kind'] = 'ingestion_source'
        LIMIT 1
      `,
      query_params: { tenantId: govProject.id, since },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{ hit: number }>;
    return rows.length > 0;
  }
}
