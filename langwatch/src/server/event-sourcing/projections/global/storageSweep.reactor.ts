import { createLogger } from "~/utils/logger/server";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";
import type { Event } from "../../domain/types";
import type { ReactorDefinition } from "../../reactors/reactor.types";

const logger = createLogger("langwatch:billing:storageSweep");

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Reactor that wakes the platform-wide storage sweep (ADR-039 Decision 5)
 * after the orgBillableEventsMeter map projection succeeds. The event is
 * ONLY a wake-up — ambient traffic substituting for a clock — and the sweep
 * itself processes EVERY billable org, so which tenant triggered it is
 * irrelevant.
 *
 * Three layers keep redundant wake-ups cheap:
 * - `shouldReact` process-local guard: one enqueue attempt per process per
 *   hour BEFORE any Redis staging round-trip (millions of daily wake-up
 *   evaluations collapse to ~one per process per hour).
 * - Queue dedup (`makeJobId` per hour, 300s TTL): churn reduction while a
 *   job is staged — NOT the correctness guarantee.
 * - The durable sweep cursor inside the service: the actual once-per-hour
 *   guarantee, across processes and restarts; a redundant sweep no-ops O(1).
 */
export function createStorageSweepReactor(deps: {
  getSweep: () => () => Promise<void>;
}): ReactorDefinition<Event> {
  let lastTriggeredHourMs = 0;

  return {
    name: "storageSweep",
    options: {
      runIn: ["worker"],
      makeJobId: () => `storage_sweep_${Math.floor(Date.now() / MS_PER_HOUR)}`,
      ttl: 300_000,
      // Platform-wide singleton work: route every wake-up to one group so
      // sweeps never run concurrently from the queue's perspective.
      groupKeyFn: () => "storage_sweep",
    },

    shouldReact() {
      const hourMs = Math.floor(Date.now() / MS_PER_HOUR);
      if (hourMs === lastTriggeredHourMs) return false;
      lastTriggeredHourMs = hourMs;
      return true;
    },

    async handle() {
      try {
        await deps.getSweep()();
      } catch (error) {
        // The sweep is self-healing (durable cursors; hourly sampling drains
        // on the next wake-up), so never fail the queue job — but a
        // persistent failure here has no other signal: surface every
        // occurrence.
        logger.error(
          { error },
          "storage sweep failed; cursors are durable, the next wake-up retries",
        );
        await withScope(async (scope) => {
          scope.setTag?.("handler", "storageSweep");
          captureException(toError(error));
        });
      }
    },
  };
}
