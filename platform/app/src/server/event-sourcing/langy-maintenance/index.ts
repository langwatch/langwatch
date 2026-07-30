/**
 * The langy-maintenance pipeline (ADR-098, ADR-100, ADR-102).
 *
 * @see specs/langy/langy-session-key-reap-sweep.feature
 *
 * Revokes every Langy session API key whose lifetime has elapsed. THIS IS THE
 * GUARANTEE, not a backstop: a manager that is SIGKILLed runs no cleanup, and
 * no callback can close that hole, because the process that would make the call
 * is the one that died. No aggregate, no events, no lane; spans every tenant.
 */

import { type Metrics, noopMetrics } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:langy-maintenance:session-key-reap");

export const LANGY_SESSION_KEY_REAP_NAME = "langySessionKeyReap" as const;

export const LANGY_SESSION_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000;

export interface LangySessionKeyReapDeps {
  /** Revokes every elapsed, unrevoked Langy session key in one statement and
   *  resolves with the number revoked. It owns its own success reporting, so
   *  this pipeline logs only its own failure modes. */
  readonly reap: () => Promise<number>;
  /** Records that this tick ran, exactly once per tick. */
  readonly recordTick: () => Promise<void>;
  readonly metrics?: Metrics;
  readonly now?: () => number;
}

/**
 * The scheduled reap (ADR-098): revokes every elapsed Langy session key, on a
 * fixed clock, independent of any worker's own shutdown path.
 *
 * Failure doctrine is `blob-maintenance`'s: the reap's failure is raised so the
 * whole tick retries, `recordTick`'s is swallowed. The reap is one bulk
 * `UPDATE ... WHERE`, so the whole call is one candidate.
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
      // One bulk statement: a thrown reap is exactly one failed candidate.
      candidates.inc({ outcome: "failure" });
      logger.error(
        { error: failure.message },
        "langy session-key reap failed; the next scheduled tick retries it",
      );
    }

    // Recorded either way: this tick happened, and a run of failing ticks must
    // not also lose its own bookkeeping.
    try {
      await deps.recordTick();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "langy session-key reap tick bookkeeping failed",
      );
    }

    // Raised so whatever schedules this tick retries the whole thing.
    if (failure) throw failure;
  };
}

/** How the reap is mounted: run `run()` every `intervalMs`, retry a thrown
 *  tick. */
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
