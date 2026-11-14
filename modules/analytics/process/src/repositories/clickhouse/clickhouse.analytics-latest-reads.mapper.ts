/** The analytics slim tables' latest-version reads, built once each (ADR-202). */
import type { AnalyticsMetricSource } from "@langwatch/analytics-contract";
import {
  clickhouseRead,
  fn,
  type ReaderReadStatement,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import type { Instant } from "@langwatch/time";

import { evaluationAnalytics } from "./clickhouse.evaluation-analytics.table.ts";
import { traceAnalytics } from "./clickhouse.trace-analytics.table.ts";

export type RecencyInput = {
  projectId: string;
  source: AnalyticsMetricSource;
  since: Instant;
  excludeOrigins?: readonly string[];
};

/**
 * The newest `OccurredAt` of the deduped slim table (ADR-034 §6), bounded on the partition column,
 * over each aggregate's latest `ReplacingMergeTree(UpdatedAt)` version. Origins are left out of
 * the newest versions only: origin is stamped late.
 */
export function lastOccurredAtRead({
  projectId,
  source,
  since,
  excludeOrigins = [],
}: RecencyInput): ReaderReadStatement<{ lastMs: number }> {
  const scope = tenantScope.single({ tenantId: projectId });
  const fromMs = since.epochMilliseconds;
  if (source === "evaluation") {
    return clickhouseRead({ scope })
      .from(evaluationAnalytics)
      .select({ lastMs: fn.max(fn.toUnixTimestamp64Milli(evaluationAnalytics.OccurredAt)) })
      .where(({ gte }) => gte(evaluationAnalytics.OccurredAt, fromMs))
      .latestVersion()
      .build();
  }
  const read = clickhouseRead({ scope })
    .from(traceAnalytics)
    .select({ lastMs: fn.max(fn.toUnixTimestamp64Milli(traceAnalytics.OccurredAt)) })
    .where(({ gte }) => gte(traceAnalytics.OccurredAt, fromMs));
  const outsideOrigins =
    excludeOrigins.length > 0
      ? read.where(({ not, oneOf }) => not(oneOf(traceAnalytics.Origin, [...excludeOrigins])), {
          inElection: false,
        })
      : read;
  return outsideOrigins.latestVersion().build();
}

const t = evaluationAnalytics;

/**
 * An evaluation's latest version, ties on `UpdatedAt` broken by folded lifecycle progress. A fold
 * read-back's own window bounds the outer read only (ADR-071); otherwise the id index bounds both.
 */
export function latestEvaluationRead({
  parsed,
  window,
}: {
  parsed: { tenantId: string; evaluationId: string };
  window: { fromMs: number; toMs: number } | null | "idBound";
}): ReaderReadStatement<Record<string, unknown>> {
  const read = clickhouseRead({ scope: tenantScope.single({ tenantId: parsed.tenantId }) })
    .from(t)
    .select({
      TenantId: t.TenantId,
      EvaluationId: t.EvaluationId,
      Version: t.Version,
      OccurredAt: t.OccurredAt,
      CreatedAt: t.CreatedAt,
      UpdatedAt: t.UpdatedAt,
      EvaluatorType: t.EvaluatorType,
      EvaluatorName: t.EvaluatorName,
      Status: t.Status,
      IsGuardrail: t.IsGuardrail,
      Passed: t.Passed,
      Score: t.Score,
      Label: t.Label,
      Model: t.Model,
      TraceId: t.TraceId,
      UserId: t.UserId,
      ConversationId: t.ConversationId,
      CustomerId: t.CustomerId,
      Origin: t.Origin,
      DurationMs: t.DurationMs,
      TotalCost: t.TotalCost,
      NonBilledCost: t.NonBilledCost,
      Attributes: t.Attributes,
      StartedAt: t.StartedAt,
      CompletedAt: t.CompletedAt,
      AppliedEventIds: t.AppliedEventIds,
    });
  const bounded =
    window === "idBound"
      ? read.where(({ idBound }) => idBound(t.EvaluationId, parsed.evaluationId))
      : read.where(({ eq }) => eq(t.EvaluationId, parsed.evaluationId));
  const windowed =
    window === "idBound" || window === null
      ? bounded
      : bounded.where(
          ({ and, gte, lte }) =>
            and(gte(t.OccurredAt, window.fromMs), lte(t.OccurredAt, window.toMs)),
          { inElection: false },
        );
  return windowed
    .latestVersion()
    .orderBy(t.OccurredAt, "DESC")
    .orderBy(t.CompletedAt, "DESC")
    .orderBy(t.StartedAt, "DESC")
    .orderBy(fn.length(t.AppliedEventIds), "DESC")
    .limit(1)
    .build();
}
