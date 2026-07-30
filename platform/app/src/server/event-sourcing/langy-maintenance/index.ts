/**
 * The langy-maintenance pipeline (ADR-098, ADR-100, ADR-102), rewritten onto
 * `@langwatch/event-sourcing` from
 * `event-sourcing.old/pipelines/langy-maintenance/` (read-only reference for
 * this rewrite; this is a rewrite of behaviour, not a port of code).
 *
 * @see specs/langy/langy-session-key-reap-sweep.feature — the contract.
 *
 * ## What this pipeline does
 *
 * Revokes every Langy session API key whose lifetime has elapsed
 * (`~/server/app-layer/langy/langyApiKey.ts`'s
 * `reapExpiredLangySessionApiKeys`, unchanged by this rewrite). THIS IS THE
 * GUARANTEE, not a redundant backstop: revoke-on-worker-death is the fast
 * path, but a manager that is SIGKILLed (OOM, node eviction, force-delete)
 * sees nothing and runs no cleanup, and every key its workers held then
 * stays valid for the rest of its TTL. No callback can close that hole,
 * because the process that would make the call is the one that died — only
 * a scheduled sweep can.
 *
 * This is queue-infrastructure maintenance, not a conversation concern,
 * which is why it carries no aggregate, no events and no commands, and
 * dispatches nothing through the event log — `withAggregateType("global")`
 * in the old pipeline was taxonomy for exactly this: a sweep with nothing to
 * append, spanning every tenant by design.
 *
 * ## A significant, deliberate gap: no mounting runtime exists yet
 *
 * See `blob-maintenance/index.ts`'s module docblock — the identical gap
 * applies here. `createLangySessionKeyReapMount` below returns the same
 * plain `{ name, intervalMs, run }` descriptor `billingMeterSweep.ts` and
 * `blob-maintenance/index.ts` do, for the same likely future home
 * (`~/server/app-layer/scheduler/scheduler.service.ts`). No `GroupKey` is
 * declared, for the same reason: nothing here dispatches through the
 * group-keyed queue (ADR-100) yet.
 *
 * ## The failure doctrine (audit finding this rewrite fixes, applied
 * identically to `blob-maintenance`)
 *
 * See `blob-maintenance/index.ts`'s module docblock for the full audit
 * finding — this pipeline was one of the five siblings that swallowed a
 * failed outbox-retention prune the same way, and its own main-work doctrine
 * was implicit (a thrown `reap()` was never caught, so it already propagated
 * — the doctrine this rewrite makes explicit and applies uniformly). The
 * same two fixes land here:
 *
 *   1. `recordTick` replaces the old outbox-retention prune, keeping its
 *      swallow-and-log doctrine (losing today's bookkeeping is recoverable
 *      at the next tick; losing today's actual reap result would not be).
 *   2. The reap's own failure is raised, mirroring `billingMeterSweep` and
 *      `blob-maintenance`. Reaping is idempotent — a key already revoked
 *      stays revoked — so a full retry costs one wasted query, never a
 *      double effect. Every tick's outcome is counted on
 *      `es_langy_session_key_reap_candidates_total{outcome}`.
 *
 * `reapExpiredLangySessionApiKeys` is one bulk `UPDATE ... WHERE` statement,
 * not a per-key loop — Postgres commits every matching row or none, so
 * unlike blob cleanup there is no per-candidate outcome to isolate: the
 * whole call is one candidate, and its own count (rows revoked) is what
 * `outcome: "success"` is counted by.
 */

import { type Metrics, noopMetrics } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:langy-maintenance:session-key-reap");

export const LANGY_SESSION_KEY_REAP_NAME = "langySessionKeyReap" as const;

/** Hourly — matches `event-sourcing.old`'s `LANGY_SESSION_KEY_REAP_INTERVAL_MS`. */
export const LANGY_SESSION_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

export interface LangySessionKeyReapDeps {
  /**
   * Revokes every elapsed, unrevoked Langy session key in one statement;
   * resolves with the number revoked. `reap` owns its own outcome
   * reporting (see `reapExpiredLangySessionApiKeys`'s docblock) — this
   * pipeline logs only ITS OWN failure modes, not a second line for the
   * same event under a different logger name.
   */
  readonly reap: () => Promise<number>;
  /**
   * Records that this tick ran, exactly once per tick. Deliberately narrow —
   * see `blob-maintenance/index.ts`'s module docblock for why this replaces
   * the old outbox-retention prune rather than reproducing it.
   */
  readonly recordTick: () => Promise<void>;
  readonly metrics?: Metrics;
  readonly now?: () => number;
}

/**
 * The scheduled reap (ADR-098): revokes every elapsed Langy session key, on
 * a fixed clock, independent of any worker's own shutdown path. See this
 * file's module docblock for the failure doctrine.
 */
export function runLangySessionKeyReap(deps: LangySessionKeyReapDeps) {
  const metrics = deps.metrics ?? noopMetrics;
  const candidates = metrics.counter({
    name: "es_langy_session_key_reap_candidates_total",
    help: "Langy session-key reap ticks, by outcome.",
    labelNames: ["outcome"],
  });

  return async (): Promise<void> => {
    let failure: Error | undefined;

    try {
      const reaped = await deps.reap();
      candidates.inc({ outcome: "success" }, reaped);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      // One bulk statement: it revoked everything eligible or nothing, so a
      // thrown reap is exactly one failed candidate, not a count to derive.
      candidates.inc({ outcome: "failure" });
      logger.error(
        { error: failure.message },
        "langy session-key reap failed; the next scheduled tick retries it",
      );
    }

    // Recorded either way: this tick happened, and a run of failing ticks
    // must not also lose its own bookkeeping (mirrors billingMeterSweep and
    // blob-maintenance).
    try {
      await deps.recordTick();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "langy session-key reap tick bookkeeping failed",
      );
    }

    // Raised, not logged-and-forgotten: whatever schedules this tick must
    // retry the whole thing. Retrying is free — a key already revoked stays
    // revoked, so re-reaping costs one wasted query, never a double effect.
    if (failure) throw failure;
  };
}

/**
 * Describes how the reap must be mounted, for a future scheduler — no
 * process-manager/scheduler runtime exists in `@langwatch/event-sourcing`
 * yet (see this file's module docblock).
 */
export interface LangySessionKeyReapMount {
  readonly name: typeof LANGY_SESSION_KEY_REAP_NAME;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
}

export function createLangySessionKeyReapMount(
  deps: LangySessionKeyReapDeps,
): LangySessionKeyReapMount {
  return {
    name: LANGY_SESSION_KEY_REAP_NAME,
    intervalMs: LANGY_SESSION_KEY_REAP_INTERVAL_MS,
    run: runLangySessionKeyReap(deps),
  };
}
