/**
 * Resolves the trace wait budget for remote-trace judging from the project's
 * own ingest lag.
 *
 * The judge of an http target waits at verdict time for the agent's remote
 * traces to arrive. How long to wait cannot be known per run, so the budget
 * is sized from how long the project's span sets usually take to finish
 * arriving in the store the trace API reads (`stored_spans`): per trace, the
 * time from its last span ending to its last span being inserted, p95 over
 * the last 7 days, as `clamp(1.25 * p95 + 5s, 10s, 120s)`. This deliberately
 * measures span-set completion, not `trace_summaries` row arrival: the
 * summary row lands with the first ingested chunk (seconds), while the full
 * span set the judge fetches can trail it by tens of seconds. Projects with
 * fewer than 20 recent traces get the default, and any query failure
 * degrades to the default too - the budget is a heuristic and must never
 * fail a run.
 *
 * @see dev/docs/adr/097-scenario-remote-trace-judging.md
 * @see specs/scenarios/remote-trace-judging.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import { getClickHouseClientForProject } from "../../clickhouse/clickhouseClient";

const logger = createLogger("langwatch:scenarios:ingest-lag");

/**
 * The budget used when the project's ingest lag cannot be measured. Matches
 * the SDKs' own default (60s): a fresh project has no lag history, and traces
 * from an uncached pipeline routinely take tens of seconds to fully land.
 */
export const DEFAULT_TRACE_WAIT_TIMEOUT_MS = 60_000;

const MIN_TRACE_WAIT_TIMEOUT_MS = 10_000;
const MAX_TRACE_WAIT_TIMEOUT_MS = 120_000;

/** Below this many recent traces the p95 is noise; use the default. */
const MIN_SAMPLE_COUNT = 20;

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  budgetMs: number;
  expiresAt: number;
}

const budgetCache = new Map<string, CacheEntry>();

/** Resolves the ClickHouse client for a project. Injectable for tests. */
export type IngestLagClientResolver = (
  projectId: string,
) => Promise<ClickHouseClient | null>;

interface IngestLagRow {
  P95LagMs: number | null;
  SampleCount: number | string;
}

/**
 * The verdict-time wait budget for a project, in milliseconds.
 *
 * Measured resolutions are cached in-process for 1 hour per project, so a
 * suite fanning out many runs costs one ClickHouse query. Failures return the
 * default and are not cached, so a recovered ClickHouse is used on the next
 * run.
 */
export async function resolveTraceWaitTimeoutMs({
  projectId,
  clientResolver = getClickHouseClientForProject,
}: {
  projectId: string;
  clientResolver?: IngestLagClientResolver;
}): Promise<number> {
  const cached = budgetCache.get(projectId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.budgetMs;
  }

  try {
    const client = await clientResolver(projectId);
    if (!client) {
      return DEFAULT_TRACE_WAIT_TIMEOUT_MS;
    }

    const result = await client.query({
      query: `
        SELECT
          quantile(0.95)(SpanLagMs) AS P95LagMs,
          count() AS SampleCount
        FROM (
          SELECT
            TraceId,
            dateDiff('millisecond', max(EndTime), max(CreatedAt)) AS SpanLagMs
          FROM stored_spans
          WHERE TenantId = {tenantId:String}
            AND StartTime >= now() - INTERVAL 7 DAY
          GROUP BY TraceId
        )
        WHERE SpanLagMs >= 0
      `,
      query_params: { tenantId: projectId },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as IngestLagRow[];

    const budgetMs = budgetFromRow(rows[0]);
    budgetCache.set(projectId, {
      budgetMs,
      expiresAt: Date.now() + CACHE_TTL_MS,
    });
    return budgetMs;
  } catch (error) {
    logger.warn(
      {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      },
      "ingest lag query failed, using the default trace wait budget",
    );
    return DEFAULT_TRACE_WAIT_TIMEOUT_MS;
  }
}

function budgetFromRow(row: IngestLagRow | undefined): number {
  const sampleCount = Number(row?.SampleCount ?? 0);
  const p95LagMs = Number(row?.P95LagMs ?? Number.NaN);
  if (sampleCount < MIN_SAMPLE_COUNT || !Number.isFinite(p95LagMs)) {
    return DEFAULT_TRACE_WAIT_TIMEOUT_MS;
  }
  // Whole milliseconds: the SDK hands the budget to timer APIs that reject
  // fractional delays, and a fractional p95 makes the formula fractional.
  return Math.round(
    Math.min(
      Math.max(1.25 * p95LagMs + 5_000, MIN_TRACE_WAIT_TIMEOUT_MS),
      MAX_TRACE_WAIT_TIMEOUT_MS,
    ),
  );
}

/** Drops every cached budget. @internal For tests. */
export function clearTraceWaitBudgetCache(): void {
  budgetCache.clear();
}
