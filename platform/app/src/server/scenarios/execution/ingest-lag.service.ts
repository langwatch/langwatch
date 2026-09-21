/**
 * Resolves the trace wait budget for remote-trace judging from the project's
 * own ingest lag.
 *
 * The judge of an http target waits at verdict time for the agent's remote
 * traces to arrive. How long to wait cannot be known per run, so the budget
 * is sized from how long the project's span sets usually take to finish
 * arriving in the store the trace API reads (`stored_spans`): per trace, the
 * time from its last span ending to its last span being inserted, p95 over
 * the last 7 days, as `clamp(1.25 * p95 + 5s, 10s, 30s)`, rounded up. This
 * deliberately measures span-set completion, not `trace_summaries` row
 * arrival: the summary row lands with the first ingested chunk (seconds),
 * while the full span set the judge fetches can trail it by tens of seconds.
 * Projects with fewer than 20 recent traces get the default, and any query
 * failure degrades to the default too - the budget is a heuristic and must
 * never fail a run. The tail above the cap is covered by the judge's one
 * `wait_for_traces` extension, not by a longer unconditional wait.
 *
 * The ClickHouse query itself lives in the ingest-lag repository; this
 * service owns the formula, the clamps and the cache.
 *
 * @see dev/docs/adr/097-scenario-remote-trace-judging.md
 * @see specs/scenarios/remote-trace-judging.feature
 */

import { createLogger } from "@langwatch/observability";
import {
  findIngestLagP95,
  type IngestLagClientResolver,
  type IngestLagSample,
} from "../repositories/ingest-lag.repository";
import { TRACE_WAIT_CAP_MS } from "./remote-trace-run-config";

const logger = createLogger("langwatch:scenarios:ingest-lag");

/**
 * The budget used when the project's ingest lag cannot be measured. Matches
 * the SDKs' own default (30s): a fresh project has no lag history, and traces
 * from an uncached pipeline routinely take tens of seconds to fully land.
 */
export const DEFAULT_TRACE_WAIT_TIMEOUT_MS = 30_000;

const MIN_TRACE_WAIT_TIMEOUT_MS = 10_000;
const MAX_TRACE_WAIT_TIMEOUT_MS = TRACE_WAIT_CAP_MS;

/** Below this many recent traces the p95 is noise; use the default. */
const MIN_SAMPLE_COUNT = 20;

const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheEntry {
  budgetMs: number;
  expiresAt: number;
}

const budgetCache = new Map<string, CacheEntry>();

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
  clientResolver,
}: {
  projectId: string;
  clientResolver?: IngestLagClientResolver;
}): Promise<number> {
  // Sweep expired entries so the cache shrinks instead of holding a row for
  // every project that ever resolved. Bounded by project count, so the sweep
  // is cheap.
  for (const [key, entry] of budgetCache) {
    if (entry.expiresAt <= Date.now()) {
      budgetCache.delete(key);
    }
  }

  const cached = budgetCache.get(projectId);
  if (cached) {
    return cached.budgetMs;
  }

  try {
    const sample = await findIngestLagP95({ projectId, clientResolver });
    if (!sample) {
      return DEFAULT_TRACE_WAIT_TIMEOUT_MS;
    }

    const budgetMs = budgetFromSample(sample);
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

function budgetFromSample(sample: IngestLagSample): number {
  if (sample.sampleCount < MIN_SAMPLE_COUNT) {
    return DEFAULT_TRACE_WAIT_TIMEOUT_MS;
  }
  // Whole milliseconds, rounded UP: the SDK hands the budget to timer APIs
  // that reject fractional delays, and a wait budget must never round below
  // the measured lag it is meant to cover.
  return Math.ceil(
    Math.min(
      Math.max(1.25 * sample.p95LagMs + 5_000, MIN_TRACE_WAIT_TIMEOUT_MS),
      MAX_TRACE_WAIT_TIMEOUT_MS,
    ),
  );
}

/** Drops every cached budget. @internal For tests. */
export function clearTraceWaitBudgetCache(): void {
  budgetCache.clear();
}

/** How many budgets the cache holds. @internal For tests. */
export function traceWaitBudgetCacheSize(): number {
  return budgetCache.size;
}
