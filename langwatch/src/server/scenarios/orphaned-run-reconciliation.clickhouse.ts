/**
 * ClickHouse-backed finder for orphaned scenario runs, plus the boot entrypoint
 * that wires it to the failure emitter.
 *
 * @see ./orphaned-run-reconciliation.ts
 * @see https://github.com/langwatch/langwatch/issues/3195
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { getSharedClickHouseClient } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import {
  type OrphanedRun,
  type OrphanedRunFinder,
  type OrphanFailureEmitter,
  reconcileOrphanedRuns,
} from "./orphaned-run-reconciliation";

const logger = createLogger("langwatch:scenarios:orphan-reconciliation");

const TABLE_NAME = "simulation_runs" as const;

/**
 * Bound the partition scan. simulation_runs is `PARTITION BY toYearWeek(StartedAt)`
 * and the store writes `StartedAt = StartedAt ?? CreatedAt`, so even a
 * queued-never-started orphan has a real recent StartedAt and is found by
 * pruning on it. Orphans older than this window are already cosmetically
 * STALLED on the read path and not worth a cold-partition scan on every boot.
 *
 * `StartedAt <= UpdatedAt` always holds, so pruning on StartedAt never excludes
 * a run the UpdatedAt staleness gate would otherwise surface.
 */
const ORPHAN_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Safety cap on a single boot sweep. */
const ORPHAN_SWEEP_LIMIT = 1000;

/**
 * Terminal run statuses — never reconciled. These are the statuses the finish
 * handler persists (SUCCESS/FAILURE/FAILED/ERROR/CANCELLED) plus STALLED. A
 * terminal status is always written together with FinishedAt, so the
 * `FinishedAt IS NULL` gate below already excludes these rows; this filter is a
 * defensive belt-and-suspenders against a future path that writes a terminal
 * status without a FinishedAt. (The same literals are duplicated inline as
 * `completedStatuses` in scenario-event.service.ts — extracting a shared
 * exported constant is a worthwhile follow-up.) Everything else —
 * PENDING/QUEUED/IN_PROGRESS — is in-flight and a reconciliation candidate.
 */
const TERMINAL_STATUSES = [
  "SUCCESS",
  "FAILURE",
  "FAILED",
  "ERROR",
  "CANCELLED",
  "STALLED",
] as const;

/**
 * Finds the latest version of every non-terminal run whose last activity is
 * older than `now - thresholdMs`, across all tenants on the shared client.
 *
 * - Dedups the ReplacingMergeTree(UpdatedAt) to the latest version per run via
 *   the IN-tuple pattern (light key columns only — no Messages.* / heavy JSON,
 *   so the scan is memory-bounded).
 * - Prunes partitions on StartedAt.
 * - Filters on UpdatedAt (the field the read-path stall detection also uses).
 */
export class ClickHouseOrphanedRunFinder implements OrphanedRunFinder {
  constructor(private readonly client: ClickHouseClient) {}

  async findOrphanedRuns({
    now,
    thresholdMs,
  }: {
    now: number;
    thresholdMs: number;
  }): Promise<OrphanedRun[]> {
    const staleBeforeMs = now - thresholdMs;
    const lookbackStartMs = now - ORPHAN_LOOKBACK_MS;

    // Partition-pruning predicate, duplicated inside the dedup subquery so the
    // inner GROUP BY prunes too (see clickhouse-queries.md "IN-Tuple Dedup").
    const partitionFilter =
      "StartedAt >= fromUnixTimestamp64Milli({lookbackStartMs:Int64})";

    // Cross-tenant sweep BY DESIGN: a boot reconciler has no single tenant to
    // scope to, so this intentionally omits the per-tenant `WHERE TenantId =`
    // filter clickhouse-queries.md mandates for tenant-scoped reads. TenantId is
    // SELECTed (not filtered), and each terminal write downstream is scoped to
    // its own run's tenant. Precedent: other system-level cross-tenant sweeps.
    const result = await this.client.query({
      query: `
        SELECT
          TenantId AS tenantId,
          ScenarioRunId AS scenarioRunId,
          ScenarioId AS scenarioId,
          BatchRunId AS batchRunId,
          ScenarioSetId AS scenarioSetId,
          Status AS status
        FROM ${TABLE_NAME}
        WHERE ${partitionFilter}
          AND (TenantId, ScenarioRunId, UpdatedAt) IN (
            SELECT TenantId, ScenarioRunId, max(UpdatedAt)
            FROM ${TABLE_NAME}
            WHERE ${partitionFilter}
            GROUP BY TenantId, ScenarioRunId
          )
          AND UpdatedAt < fromUnixTimestamp64Milli({staleBeforeMs:Int64})
          AND FinishedAt IS NULL
          AND ArchivedAt IS NULL
          AND NOT has({terminalStatuses:Array(String)}, Status)
        LIMIT {limit:UInt32}
      `,
      query_params: {
        lookbackStartMs,
        staleBeforeMs,
        terminalStatuses: TERMINAL_STATUSES,
        limit: ORPHAN_SWEEP_LIMIT,
      },
      format: "JSONEachRow",
    });

    return result.json<OrphanedRun>();
  }
}

/**
 * Boot entrypoint: reconcile runs orphaned by a previous worker that died
 * mid-flight. No-op when ClickHouse is not configured.
 *
 * Limitation: tenants on private ClickHouse instances (CLICKHOUSE_URL__* envs)
 * are not swept — only the shared client is. Tracked on issue #3195.
 */
export async function reconcileOrphanedRunsOnBoot({
  failureEmitter,
  client = getSharedClickHouseClient(),
  now,
}: {
  failureEmitter: OrphanFailureEmitter;
  client?: ClickHouseClient | null;
  now?: number;
}): Promise<{ reconciled: number; failed: number }> {
  if (!client) {
    logger.info(
      "No ClickHouse client configured; skipping orphaned-run reconciliation",
    );
    return { reconciled: 0, failed: 0 };
  }

  const finder = new ClickHouseOrphanedRunFinder(client);
  return reconcileOrphanedRuns({ finder, failureEmitter, now });
}
