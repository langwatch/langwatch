// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  clickhouseRead,
  type Condition,
  type ConditionOps,
  fn,
  param,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import { createLogger } from "@langwatch/observability";
import { type Instant, toDate } from "@langwatch/time";

import type {
  AnomalySpendReader,
  AnomalySpendSourceFilter,
  GovernanceKpiContribution,
  GovernanceKpiContributionWriter,
  GovernanceClickHouseReadResolver,
} from "../governance.repositories.ts";
import { governanceKpis as kpis } from "./clickhouse.governance-kpis.table.ts";

/**
 * ClickHouseAnomalySpendRepository — reads and writes the
 * `governance_kpis` fold projection.
 *
 * Writes: `insertContribution` inserts ONE row keyed by (TenantId,
 * SourceId, HourBucket, TraceId) so subscriber replays of the same trace
 * collapse at merge time. Replays are not the only source of multiple live
 * versions, though: the writer is level-triggered and re-states a trace's
 * running total once per throttle window, so a long trace leaves several
 * rows under one key as a matter of course. Every read here must therefore
 * be replacement-aware — see `findSpendTotals`.
 *
 * Reads: `findSpendTotals` serves the spend-spike anomaly evaluator's
 * current/baseline window comparison, and is this table's only production
 * read. ActivityMonitorService does not read it, despite the forward-looking
 * note at activityMonitor.service.ts:494.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 * Migration: 00031_create_governance_kpis.sql
 */
const TABLE_NAME = kpis.$table.name;

type KpisTable = "governance_kpis";

const logger = createLogger("langwatch:governance:clickhouse-anomaly-spend-repository");

export class ClickHouseAnomalySpendRepository
  implements AnomalySpendReader, GovernanceKpiContributionWriter
{
  private constructor(private readonly resolveClient: GovernanceClickHouseReadResolver) {}

  static create(resolveClient: GovernanceClickHouseReadResolver): ClickHouseAnomalySpendRepository {
    return new ClickHouseAnomalySpendRepository(resolveClient);
  }

  async insertContribution(row: GovernanceKpiContribution): Promise<void> {
    if (!row.tenantId || !row.sourceId || !row.traceId) {
      throw new Error(
        "ClickHouseAnomalySpendRepository.insertContribution: tenantId / sourceId / traceId are required",
      );
    }
    try {
      const client = await this.resolveClient(row.tenantId);
      await client.insert({
        table: TABLE_NAME,
        values: [
          {
            TenantId: row.tenantId,
            SourceId: row.sourceId,
            SourceType: row.sourceType,
            HourBucket: toDate(row.hourBucket),
            TraceId: row.traceId,
            SpendUsd: row.spendUsd,
            PromptTokens: row.promptTokens,
            CompletionTokens: row.completionTokens,
            LastEventOccurredAt: toDate(row.lastEventOccurredAt),
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 0 },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: row.tenantId,
          sourceId: row.sourceId,
          traceId: row.traceId,
          error: errorMessage,
        },
        "Failed to insert governance_kpis contribution",
      );
      throw error;
    }
  }

  /**
   * Current-window and baseline-window spend totals from `governance_kpis`,
   * for the spend-spike anomaly evaluator. `sourceFilter` narrows to a
   * single SourceId / SourceType when the rule is scoped that way; org/
   * team/project-scoped rules pass an empty filter since the TenantId
   * predicate (the org's hidden Gov Project) already covers the whole
   * tenant.
   *
   * Read in TWO PASSES, and it has to be. The table is a
   * ReplacingMergeTree(LastEventOccurredAt) whose writer is level-triggered:
   * governanceKpisSync.subscriber.ts writes the fold's RUNNING TOTAL for a
   * trace once per throttle window, so a trace spanning three windows leaves
   * three live rows carrying $2, $5, $9. Several versions per key is normal
   * operation here, not a rare replay. A single-pass `sumIf` adds them and
   * reports $16 for $9 of spend — and because long traces bunch into the
   * current window while the baseline averages six, the inflation lands
   * harder on the numerator and reads as a spike that never happened.
   *
   * So the inner query collapses each (TenantId, SourceId, HourBucket,
   * TraceId) — the full sort key — to `argMax(SpendUsd, LastEventOccurredAt)`,
   * and the outer one sums only the survivors. `SpendUsd` is a non-Nullable
   * Float64, so it needs none of the `tuple(...)` guard the cost rollup's
   * Nullable amounts do.
   *
   * `sourceFilter` goes in the INNER query so it prunes before the grouping.
   * It can name `SourceType`, which is not in the sort key; that is safe
   * because SourceType is a property of the ingestion source rather than of
   * the trace, so it does not vary between versions of one key.
   *
   * Residual, deliberately not handled: `HourBucket` is itself part of the
   * key. If a trace's business time were ever revised across an hour
   * boundary, its two versions would be different keys, both would survive
   * the dedup, and the total would still count both. That needs the writer to
   * stop moving a live row's bucket, not a different read.
   */
  async findSpendTotals(input: {
    tenantId: string;
    windowStart: Instant;
    windowEnd: Instant;
    baselineStart: Instant;
    sourceFilter: AnomalySpendSourceFilter;
  }): Promise<{ currentSpend: number; baselineSpend: number }> {
    const client = await this.resolveClient(input.tenantId);
    const scope = tenantScope.single({ tenantId: input.tenantId });
    const windowStart = param.epochMs(input.windowStart.epochMilliseconds);
    const baselineStart = param.epochMs(input.baselineStart.epochMilliseconds);
    const windowEnd = param.epochMs(input.windowEnd.epochMilliseconds);
    const latest = clickhouseRead({ scope })
      .from(kpis)
      .select({
        TenantId: kpis.TenantId,
        SourceId: kpis.SourceId,
        HourBucket: kpis.HourBucket,
        TraceId: kpis.TraceId,
        LatestSpendUsd: fn.argMax(kpis.SpendUsd, kpis.LastEventOccurredAt),
      })
      .where((ops) =>
        ops.and(
          ops.gte(kpis.HourBucket, baselineStart),
          ops.lt(kpis.HourBucket, windowEnd),
          ...sourceConditionsOf({ filter: input.sourceFilter, eq: ops.eq }),
        ),
      )
      .groupBy(kpis.TenantId, kpis.SourceId, kpis.HourBucket, kpis.TraceId)
      .as("latest");
    const statement = clickhouseRead({ scope })
      .from(latest)
      .select(({ and, gte, lt }) => ({
        currentSpend: fn.sumIf(latest.LatestSpendUsd, gte(latest.HourBucket, windowStart)),
        baselineSpend: fn.sumIf(
          latest.LatestSpendUsd,
          and(lt(latest.HourBucket, windowStart), gte(latest.HourBucket, baselineStart)),
        ),
      }))
      .build();
    const { rows } = await client.read({ statement });
    const row = rows[0];
    return {
      currentSpend: Number(row?.currentSpend ?? 0),
      baselineSpend: Number(row?.baselineSpend ?? 0),
    };
  }
}

/** The rule's source narrowing, pruned before the grouping; none for an org-wide rule. */
function sourceConditionsOf({
  filter,
  eq,
}: {
  filter: AnomalySpendSourceFilter;
  eq: ConditionOps<KpisTable, Record<never, never>>["eq"];
}): Condition<KpisTable>[] {
  if (filter.type === "source") return [eq(kpis.SourceId, filter.id)];
  if (filter.type === "source_type") return [eq(kpis.SourceType, filter.id)];
  return [];
}
