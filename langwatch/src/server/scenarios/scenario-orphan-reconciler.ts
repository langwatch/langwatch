/**
 * Startup reconciler for orphaned QUEUED scenario runs.
 *
 * Belt-and-braces safety net for the graceful drain in scenario.processor.ts.
 * When a worker is hard-killed (OOM, SIGKILL) it has no chance to mark its
 * in-flight runs failed, so those runs sit at QUEUED forever with no live
 * worker to finish them and the suites page polls them indefinitely.
 *
 * On worker startup this scans ClickHouse for runs that have been QUEUED with
 * no progress for longer than the stall threshold and emits a terminal failure
 * for each, so the user sees a terminal result instead of a permanent spinner.
 *
 * The pure gate (isOrphanedQueuedRun) and the orchestrator
 * (reconcileOrphanedQueuedRuns) are side-effect-free given injected
 * dependencies and are unit-tested without ClickHouse. The candidate-finder
 * (findQueuedRunCandidates) owns the cross-tenant scan.
 *
 * @see specs/scenarios/queued-run-orphan-recovery.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { createLogger } from "~/utils/logger/server";
import { ScenarioRunStatus } from "./scenario-event.enums";
import { STALL_THRESHOLD_MS } from "./stall-detection";

const logger = createLogger("langwatch:scenarios:orphan-reconciler");

// Mirrors the per-file TABLE_NAME constant in the sibling simulation_runs CH repositories.
const TABLE_NAME = "simulation_runs" as const;

/**
 * How far back the reconciler scans. Orphans older than this window are NOT
 * reconciled — they are ancient/abandoned and any consumer has long since
 * stopped polling. The bound also keeps the cross-tenant partition scan small
 * (simulation_runs is partitioned by toYearWeek(StartedAt)).
 */
export const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * How long a run may sit QUEUED with no progress before the reconciler treats
 * it as orphaned. Equal to STALL_THRESHOLD_MS (2× the child-process timeout) —
 * the same "no progress for too long" horizon the read-time stall detector
 * uses — but defined here as its own constant on purpose: the orphan gate is
 * about QUEUE liveness ("no worker ever picked this up"), a distinct concern
 * from the stall detector's IN_PROGRESS execution liveness, even though the two
 * currently coincide.
 */
export const ORPHAN_QUEUED_THRESHOLD_MS = STALL_THRESHOLD_MS;

/** A QUEUED run found by the cross-tenant scan, candidate for reconciliation. */
export interface OrphanCandidate {
  projectId: string;
  scenarioRunId: string;
  scenarioId: string;
  batchRunId: string;
  setId: string;
  lastEventAtMs: number;
  status: string;
}

/**
 * Pure gate: is this run an orphaned QUEUED run?
 *
 * True ONLY when the run is QUEUED AND its last event is at least `thresholdMs`
 * old. A non-QUEUED run, or a QUEUED run that has had recent activity, is not
 * an orphan — this is the guard against falsely failing healthy queued runs
 * that a worker is about to (or recently did) pick up.
 */
export function isOrphanedQueuedRun({
  status,
  lastEventAtMs,
  now,
  thresholdMs,
}: {
  status: string;
  lastEventAtMs: number;
  now: number;
  thresholdMs: number;
}): boolean {
  if (status !== ScenarioRunStatus.QUEUED) return false;
  return now - lastEventAtMs >= thresholdMs;
}

/**
 * Find QUEUED-at-latest-version runs across ALL tenants within the lookback
 * window.
 *
 * INTENTIONALLY cross-tenant: this is a startup ops reconciler (like the
 * storage-metering / TTL scans) and runs with the shared ClickHouse client, so
 * it deliberately omits the per-tenant `TenantId = {...}` filter that every
 * other simulation_runs query carries. This is the one documented exception to
 * the per-tenant rule.
 *
 * Latest version per (TenantId, ScenarioRunId) is resolved with GROUP BY +
 * argMax(col, UpdatedAt) (never max(col)). simulation_runs is a
 * ReplacingMergeTree(UpdatedAt); ScenarioRunId is a globally-unique KSUID, so
 * grouping by (TenantId, ScenarioRunId) collapses every version of a run even
 * though the table's full dedup key also includes ScenarioSetId/BatchRunId.
 * Only groups whose latest Status is 'QUEUED' are returned. The scan is
 * partition-pruned on StartedAt for the lookback window (StartedAt defaults to
 * the queue/insert time, so QUEUED orphans fall in their queue-week partition).
 * Selected columns are light, and per-group non-key values use argMax(col,
 * UpdatedAt) (never `max(col)`) so we read the latest version's ids, not a
 * stale one.
 */
export async function findQueuedRunCandidates({
  client,
  lookbackMs,
  now,
}: {
  client: ClickHouseClient;
  lookbackMs: number;
  now: number;
}): Promise<OrphanCandidate[]> {
  const fromMs = now - lookbackMs;

  const result = await client.query({
    query: `
      SELECT
        TenantId AS TenantId,
        ScenarioRunId AS ScenarioRunId,
        argMax(ScenarioId, UpdatedAt) AS ScenarioId,
        argMax(BatchRunId, UpdatedAt) AS BatchRunId,
        argMax(ScenarioSetId, UpdatedAt) AS ScenarioSetId,
        argMax(Status, UpdatedAt) AS Status,
        toUnixTimestamp64Milli(max(UpdatedAt)) AS LastEventAtMs
      FROM ${TABLE_NAME}
      WHERE StartedAt >= fromUnixTimestamp64Milli(toUInt64({fromMs:String}))
      GROUP BY TenantId, ScenarioRunId
      HAVING Status = '${ScenarioRunStatus.QUEUED}'
      LIMIT 10000
    `,
    query_params: { fromMs: String(fromMs) },
    format: "JSONEachRow",
  });

  const rows = await result.json<{
    TenantId: string;
    ScenarioRunId: string;
    ScenarioId: string;
    BatchRunId: string;
    ScenarioSetId: string;
    Status: string;
    LastEventAtMs: string | number;
  }>();

  return rows.map((row) => ({
    projectId: row.TenantId,
    scenarioRunId: row.ScenarioRunId,
    scenarioId: row.ScenarioId,
    batchRunId: row.BatchRunId,
    setId: row.ScenarioSetId,
    status: row.Status,
    lastEventAtMs: Number(row.LastEventAtMs),
  }));
}

/**
 * Orchestrate reconciliation: fetch candidates, keep only the genuine orphans
 * (per isOrphanedQueuedRun), and emit a terminal failure for each.
 *
 * Each emission is isolated in a try/catch so one bad run does not abort the
 * sweep; a run whose emission rejects is counted as skipped.
 */
export async function reconcileOrphanedQueuedRuns({
  findCandidates,
  emitFailure,
  now,
  thresholdMs,
}: {
  findCandidates: () => Promise<OrphanCandidate[]>;
  emitFailure: (candidate: OrphanCandidate) => Promise<void>;
  now: number;
  thresholdMs: number;
}): Promise<{ failed: number; skipped: number }> {
  const candidates = await findCandidates();
  const orphans = candidates.filter((c) =>
    isOrphanedQueuedRun({
      status: c.status,
      lastEventAtMs: c.lastEventAtMs,
      now,
      thresholdMs,
    }),
  );

  let failed = 0;
  // Non-orphan candidates are skipped by definition; rejected emissions add to
  // this count below.
  let skipped = candidates.length - orphans.length;

  for (const orphan of orphans) {
    try {
      await emitFailure(orphan);
      failed++;
    } catch (err) {
      skipped++;
      logger.warn(
        { err, scenarioRunId: orphan.scenarioRunId, projectId: orphan.projectId },
        "Failed to reconcile orphaned queued run",
      );
    }
  }

  logger.info(
    { failed, skipped, candidates: candidates.length },
    "Orphaned queued run reconciliation complete",
  );

  return { failed, skipped };
}
