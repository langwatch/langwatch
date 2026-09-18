// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Instant } from "@langwatch/time";

import type {
  AnomalySpendReader,
  AnomalySpendSourceFilter,
  GovernanceKpiContribution,
  GovernanceKpiContributionWriter,
} from "../../app/governance.members.ts";

/**
 * The anomaly-spend twin: an append-only log of contributions, honest about
 * the live table's own replacement rule — the newest contribution for a
 * given (sourceId, hourBucket, traceId) wins, matching the ClickHouse
 * `argMax(SpendUsd, LastEventOccurredAt)` collapse the live reader performs.
 */
export class MemoryAnomalySpendRepository
  implements AnomalySpendReader, GovernanceKpiContributionWriter
{
  private readonly contributions: GovernanceKpiContribution[] = [];

  static create(): MemoryAnomalySpendRepository {
    return new MemoryAnomalySpendRepository();
  }

  async insertContribution(row: GovernanceKpiContribution): Promise<void> {
    this.contributions.push(row);
  }

  async findSpendTotals(input: {
    tenantId: string;
    windowStart: Instant;
    windowEnd: Instant;
    baselineStart: Instant;
    sourceFilter: AnomalySpendSourceFilter;
  }): Promise<{ currentSpend: number; baselineSpend: number }> {
    const latest = this.latestByKey(input.tenantId, input.sourceFilter);
    const windowStartMs = input.windowStart.epochMilliseconds;
    const windowEndMs = input.windowEnd.epochMilliseconds;
    const baselineStartMs = input.baselineStart.epochMilliseconds;

    let currentSpend = 0;
    let baselineSpend = 0;
    for (const row of latest) {
      const hourMs = row.hourBucket.epochMilliseconds;
      if (hourMs < baselineStartMs || hourMs >= windowEndMs) continue;
      if (hourMs >= windowStartMs) {
        currentSpend += row.spendUsd;
      } else {
        baselineSpend += row.spendUsd;
      }
    }
    return { currentSpend, baselineSpend };
  }

  private latestByKey(
    tenantId: string,
    sourceFilter: AnomalySpendSourceFilter,
  ): GovernanceKpiContribution[] {
    const matching = this.contributions.filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (sourceFilter.type === "source" && row.sourceId !== sourceFilter.id) return false;
      if (sourceFilter.type === "source_type" && row.sourceType !== sourceFilter.id) return false;
      return true;
    });
    const latestByKey = new Map<string, GovernanceKpiContribution>();
    for (const row of matching) {
      const key = `${row.sourceId}:${row.hourBucket.epochMilliseconds}:${row.traceId}`;
      const current = latestByKey.get(key);
      if (
        !current ||
        row.lastEventOccurredAt.epochMilliseconds > current.lastEventOccurredAt.epochMilliseconds
      ) {
        latestByKey.set(key, row);
      }
    }
    return [...latestByKey.values()];
  }
}
