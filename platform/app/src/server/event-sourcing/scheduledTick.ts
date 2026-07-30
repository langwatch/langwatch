import { type Metrics, noopMetrics } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";

/**
 * A maintenance pipeline that has no aggregate, no events and no lane: it runs
 * one unit of work on a fixed clock (ADR-098). The work's own failure is raised
 * so whatever schedules the tick retries it; `recordTick`'s failure is
 * swallowed, because a run of failing ticks must not also lose its bookkeeping.
 */
export interface ScheduledTickWork {
  /** Items this tick handled, split by outcome. A tick that has no items to
   *  count reports zero of each. */
  readonly succeeded: number;
  readonly failed: number;
  /** Raised after `recordTick`, so a partially failed tick still retries. */
  readonly failure?: Error;
}

export interface ScheduledTickDeps<Name extends string> {
  readonly name: Name;
  readonly intervalMs: number;
  readonly work: () => Promise<ScheduledTickWork>;
  /** Records that this tick ran, exactly once per tick. */
  readonly recordTick: () => Promise<void>;
  readonly metrics?: Metrics;
  /** Metric name prefix, e.g. `es_blob_cleanup`. */
  readonly metricPrefix: string;
}

/** How a scheduled tick is mounted: run `run()` every `intervalMs`, retry a
 *  thrown tick. */
export interface ScheduledTickMount<Name extends string> {
  readonly name: Name;
  readonly intervalMs: number;
  readonly run: () => Promise<void>;
}

export function scheduledTick<Name extends string>(
  deps: ScheduledTickDeps<Name>,
): ScheduledTickMount<Name> {
  const logger = createLogger(`langwatch:event-sourcing:${deps.name}`);
  const metrics = deps.metrics ?? noopMetrics;
  // Two counters, not one: a tick and an item are different units, so adding
  // an item count to a tick counter makes every ratio off it meaningless.
  const ticks = metrics.counter({
    name: `${deps.metricPrefix}_ticks_total`,
    help: `Scheduled ${deps.name} ticks, by outcome.`,
    labelNames: ["outcome"],
  });
  const items = metrics.counter({
    name: `${deps.metricPrefix}_items_total`,
    help: `Items the ${deps.name} tick handled, by outcome.`,
    labelNames: ["outcome"],
  });

  return {
    name: deps.name,
    intervalMs: deps.intervalMs,
    run: async (): Promise<void> => {
      let failure: Error | undefined;

      try {
        const outcome = await deps.work();
        failure = outcome.failure;
        if (outcome.succeeded > 0) {
          items.inc({ outcome: "success" }, outcome.succeeded);
        }
        if (outcome.failed > 0) items.inc({ outcome: "failure" }, outcome.failed);
        ticks.inc({ outcome: failure ? "failure" : "success" });
      } catch (error) {
        failure = error instanceof Error ? error : new Error(String(error));
        // The work never returned a report, so there is no item set to
        // attribute this against — it counts as one failed tick and no items.
        ticks.inc({ outcome: "failure" });
        logger.error(
          { error: failure.message },
          `${deps.name} failed; the next scheduled tick retries it`,
        );
      }

      try {
        await deps.recordTick();
      } catch (error) {
        logger.warn(
          { error: error instanceof Error ? error.message : String(error) },
          `${deps.name} tick bookkeeping failed`,
        );
      }

      if (failure) throw failure;
    },
  };
}
