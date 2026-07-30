/**
 * The langy-maintenance pipeline (ADR-098, ADR-100, ADR-102).
 *
 * @see specs/langy/langy-session-key-reap-sweep.feature
 *
 * Revokes every Langy session API key whose lifetime has elapsed. THIS IS THE
 * GUARANTEE, not a backstop: a manager that is SIGKILLed runs no cleanup, and
 * no callback can close that hole, because the process that would make the call
 * is the one that died.
 */

import type { Metrics } from "@langwatch/event-sourcing";
import { scheduledTick, type ScheduledTickMount } from "../scheduledTick";

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
}

export type LangySessionKeyReapMount = ScheduledTickMount<
  typeof LANGY_SESSION_KEY_REAP_NAME
>;

export function createLangySessionKeyReapMount(
  deps: LangySessionKeyReapDeps,
): LangySessionKeyReapMount {
  return scheduledTick({
    name: LANGY_SESSION_KEY_REAP_NAME,
    intervalMs: LANGY_SESSION_KEY_REAP_INTERVAL_MS,
    metrics: deps.metrics,
    metricPrefix: "es_langy_session_key_reap",
    recordTick: deps.recordTick,
    // One bulk `UPDATE ... WHERE`: the keys it revoked are the items, and a
    // thrown reap is one failed tick with no items to attribute.
    work: async () => ({ succeeded: await deps.reap(), failed: 0 }),
  });
}
