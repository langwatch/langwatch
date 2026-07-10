/**
 * Liveness sweep for orphaned Langy turns (ADR-044 part 2).
 *
 * The deploy-survival backstop, analogous to `reconcileOrphanedQueuedRuns`.
 * When a worker pod is replaced (or OOM-killed) mid-turn its per-turn reconcile
 * timer is lost, but the turn is still `running` on the fold with no live
 * heartbeat. This sweep — run on worker boot and on an interval on EVERY worker
 * — scans the fold for in-flight turns whose heartbeat has lapsed and drives
 * them to a terminal state so a turn never hangs forever.
 *
 * Recovery is the sweep's job, NOT event replay's (ADR-030): a control-plane
 * worker replaying the log must not re-spawn from an in-flight `agent_turn_started`.
 *
 * @see src/server/scenarios/scenario-orphan-reconciler.ts (the pattern copied)
 * @see specs/langy/langy-event-driven-turns.feature
 */

import { getSharedClickHouseClient } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { LANGY_CONVERSATION_STATUS } from "~/server/event-sourcing/pipelines/langy-conversation-processing/schemas/constants";
import type { LangyConversationService } from "~/server/app-layer/langy/langy-conversation.service";
import { LANGY_LIVENESS } from "../streaming/langy.streaming.constants";
import type { LangyTokenBuffer } from "../streaming/langyTokenBuffer";

const logger = createLogger("langwatch:langy:turn-reconciler");

const TABLE_NAME = "langy_conversations" as const;

/**
 * The action the reconcile policy chooses for a stalled turn (ADR-044).
 *
 * The full ladder is encoded here for when its inputs exist; v1's sweep only
 * supplies `hardError=false`, `hadSideEffect` unknown, and no attempts counter,
 * so it runs with `maxAttempts=1` and every stalled turn resolves to `give-up`
 * (fail terminally). Auto-retry needs (a) an attempts counter on the aggregate
 * and (b) a manager-side idempotency key so a re-driven turn can't double-open a
 * PR — both are documented follow-ups. Until then reconcile is deliberately
 * conservative: surface a stalled turn as a failure rather than risk a duplicate
 * side effect.
 */
export type ReconcileAction = "resume" | "retry" | "give-up" | "fail-fast";

export function decideReconcileAction({
  finalized,
  hardError,
  attempts,
  maxAttempts,
  hadSideEffect,
}: {
  /** A `turn_finalized`/terminal already arrived — no-op. */
  finalized: boolean;
  /** The worker reported a hard, non-retryable error. */
  hardError: boolean;
  /** How many attempts this turn has already had. */
  attempts: number;
  /** Retry budget. */
  maxAttempts: number;
  /** The turn made side-effecting progress (e.g. opened a PR). */
  hadSideEffect: boolean;
}): ReconcileAction {
  if (finalized) return "resume";
  if (hardError) return "fail-fast";
  // Never blindly retry a turn that already had a side effect — it is not
  // idempotent, so a retry could double-open a PR.
  if (hadSideEffect) return "give-up";
  if (attempts >= maxAttempts) return "give-up";
  return "retry";
}

/** A `running` turn found by the cross-tenant fold scan. */
export interface InFlightTurnCandidate {
  projectId: string;
  conversationId: string;
  turnId: string;
  lastActivityAtMs: number;
}

export interface LangyTurnReconcilerDeps {
  buffer: Pick<LangyTokenBuffer, "liveness">;
  conversations: Pick<LangyConversationService, "failTurn">;
  /** Injectable candidate finder — defaults to the shared cross-tenant CH scan. */
  findCandidates?: () => Promise<InFlightTurnCandidate[]>;
  now?: number;
}

/**
 * Find `running` turns across ALL tenants within the lookback window.
 *
 * INTENTIONALLY cross-tenant (like the scenario orphan reconciler): a startup
 * ops sweep on the shared ClickHouse client. Latest version per
 * (TenantId, ConversationId) via `argMax(col, UpdatedAt)` — never FINAL, never
 * `max(col)`. Partition-pruned on CreatedAt for the lookback window.
 */
export async function findInFlightTurnCandidates({
  client,
  lookbackMs,
  now,
}: {
  client: import("@clickhouse/client").ClickHouseClient;
  lookbackMs: number;
  now: number;
}): Promise<InFlightTurnCandidate[]> {
  const lookbackHours = Math.max(1, Math.ceil(lookbackMs / (60 * 60 * 1000)));
  void now;
  const result = await client.query({
    query: `
      SELECT
        TenantId AS TenantId,
        ConversationId AS ConversationId,
        argMax(CurrentTurnId, UpdatedAt) AS CurrentTurnId,
        argMax(Status, UpdatedAt) AS Status,
        argMax(if(LastActivityAt IS NULL, 0, toUnixTimestamp64Milli(LastActivityAt)), UpdatedAt) AS LastActivityAtMs
      FROM ${TABLE_NAME}
      WHERE CreatedAt >= now() - INTERVAL {lookbackHours:UInt32} HOUR
      GROUP BY TenantId, ConversationId
      HAVING Status = '${LANGY_CONVERSATION_STATUS.RUNNING}'
        AND CurrentTurnId != ''
      LIMIT 10000
    `,
    query_params: { lookbackHours },
    format: "JSONEachRow",
  });
  const rows = await result.json<{
    TenantId: string;
    ConversationId: string;
    CurrentTurnId: string;
    Status: string;
    LastActivityAtMs: string | number;
  }>();
  return rows.map((r) => ({
    projectId: r.TenantId,
    conversationId: r.ConversationId,
    turnId: r.CurrentTurnId,
    lastActivityAtMs: Number(r.LastActivityAtMs ?? 0),
  }));
}

/**
 * Sweep for in-flight turns with a lapsed heartbeat and drive each to a terminal
 * state. Returns counts (failed / skipped-alive / errored) for observability.
 */
export async function reconcileLangyTurns(
  deps: LangyTurnReconcilerDeps,
): Promise<{ failed: number; skippedAlive: number; errored: number }> {
  const now = deps.now ?? Date.now();

  const findCandidates =
    deps.findCandidates ??
    (async () => {
      const client = getSharedClickHouseClient();
      if (!client) return [];
      return findInFlightTurnCandidates({
        client,
        lookbackMs: LANGY_LIVENESS.SWEEP_LOOKBACK_MS,
        now,
      });
    });

  const candidates = await findCandidates();

  let failed = 0;
  let skippedAlive = 0;
  let errored = 0;

  for (const candidate of candidates) {
    try {
      const liveness = await deps.buffer.liveness({
        conversationId: candidate.conversationId,
        turnId: candidate.turnId,
        now,
      });
      if (!liveness.stale) {
        // A healthy, progressing turn keeps its heartbeat fresh — leave it.
        skippedAlive++;
        continue;
      }

      // v1 conservatism: no attempts counter + no idempotency key yet, so every
      // stalled turn resolves to give-up (fail terminally). failAgentTurn is
      // idempotent on (tenant, conversation, turn) so a concurrent sweep on
      // another worker deduplicates.
      const action = decideReconcileAction({
        finalized: false,
        hardError: false,
        attempts: 1,
        maxAttempts: 1,
        hadSideEffect: false,
      });
      if (action === "resume") {
        skippedAlive++;
        continue;
      }

      await deps.conversations.failTurn({
        projectId: candidate.projectId,
        conversationId: candidate.conversationId,
        turnId: candidate.turnId,
        error:
          "Reconciled: turn stalled with no live worker (heartbeat lapsed)",
      });
      failed++;
    } catch (err) {
      errored++;
      logger.warn(
        {
          err,
          conversationId: candidate.conversationId,
          turnId: candidate.turnId,
        },
        "Failed to reconcile stalled langy turn",
      );
    }
  }

  if (candidates.length > 0) {
    logger.info(
      { failed, skippedAlive, errored, candidates: candidates.length },
      "Langy turn reconciliation complete",
    );
  }

  return { failed, skippedAlive, errored };
}
