import { createLogger } from "@langwatch/observability";
import type {
  LogFactsContribution,
  MetricFactsContribution,
  SpanFactsContribution,
} from "../schema";

const logger = createLogger(
  "langwatch:coding-agent-processing:contribution-sweep",
);

/**
 * The durability guarantee behind `dispatch.ts`'s three losable pokes: a
 * scheduled re-list and re-dispatch of the whole candidate set every tick,
 * never a diff against what already landed. Every contribution command is
 * idempotent under its own natural key, so a repeat dispatch is a no-op at
 * the fold and a collapsed row at the contributions store.
 */

export interface ContributionSweepDeps {
  /** Every span-derived contribution that should exist as of this tick, for the window `listSpanCandidates` itself decides. See the module docblock. */
  readonly listSpanCandidates: () => Promise<readonly SpanFactsContribution[]>;
  readonly listLogCandidates: () => Promise<readonly LogFactsContribution[]>;
  readonly listMetricCandidates: () => Promise<
    readonly MetricFactsContribution[]
  >;

  readonly dispatchSpanFacts: (data: SpanFactsContribution) => Promise<void>;
  readonly dispatchLogFacts: (data: LogFactsContribution) => Promise<void>;
  readonly dispatchMetricFacts: (
    data: MetricFactsContribution,
  ) => Promise<void>;

  /** Records that this tick ran — see `billingMeterSweep.ts`'s identical `recordTick` for the known gap this narrows around (no process-manager/outbox primitive exists yet). */
  readonly recordTick: () => Promise<void>;
  readonly now?: () => number;
}

export interface ContributionSweepOutcome {
  readonly dispatched: number;
  readonly failed: number;
}

/**
 * One tick: list every signal's candidate set independently, dispatch each
 * one, record the tick, then raise if anything failed. A candidate-listing
 * failure for one signal never prevents the other two from running — the
 * same "each attempted independently" shape `billingMeterSweep.ts` uses for
 * its grace-window months.
 */
export function runContributionSweep(deps: ContributionSweepDeps) {
  return async (): Promise<ContributionSweepOutcome> => {
    let dispatched = 0;
    const failures: Error[] = [];

    async function sweepSignal<Contribution>(args: {
      readonly signal: string;
      readonly list: () => Promise<readonly Contribution[]>;
      readonly dispatch: (data: Contribution) => Promise<void>;
    }): Promise<void> {
      let candidates: readonly Contribution[];
      try {
        candidates = await args.list();
      } catch (error) {
        const failure =
          error instanceof Error ? error : new Error(String(error));
        failures.push(failure);
        logger.error(
          { signal: args.signal, error: failure.message },
          "contribution sweep could not list candidates for this signal; this signal is skipped for this tick and retried with it",
        );
        return;
      }

      for (const candidate of candidates) {
        try {
          await args.dispatch(candidate);
          dispatched++;
        } catch (error) {
          failures.push(
            error instanceof Error ? error : new Error(String(error)),
          );
          logger.error(
            {
              signal: args.signal,
              error: error instanceof Error ? error.message : String(error),
            },
            "contribution sweep could not dispatch a candidate; it stays undispatched until a later attempt succeeds",
          );
        }
      }
    }

    await sweepSignal({
      signal: "span",
      list: deps.listSpanCandidates,
      dispatch: deps.dispatchSpanFacts,
    });
    await sweepSignal({
      signal: "log",
      list: deps.listLogCandidates,
      dispatch: deps.dispatchLogFacts,
    });
    await sweepSignal({
      signal: "metric",
      list: deps.listMetricCandidates,
      dispatch: deps.dispatchMetricFacts,
    });

    // Recorded before any failure is raised: this tick happened either way.
    try {
      await deps.recordTick();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "contribution sweep tick bookkeeping failed",
      );
    }

    if (failures.length > 0) {
      const [firstFailure] = failures;
      // Raised, not swallowed — whatever schedules this tick must retry the
      // whole thing. Re-dispatching candidates that already succeeded is
      // free (idempotent by natural key), so a retried tick costs nothing
      // beyond the wasted writes.
      throw firstFailure;
    }

    return { dispatched, failed: failures.length };
  };
}

export const CONTRIBUTION_SWEEP_NAME = "codingAgentContributionSweep" as const;

/**
 * Mount descriptor for a future scheduler — no process-manager/scheduler
 * runtime exists in `@langwatch/event-sourcing` yet (the same gap
 * `billing-reporting/reporting/billingMeterSweep.ts` documents), so this
 * stays a plain descriptor rather than a call into a mount API that does
 * not exist. The pre-existing, generic
 * `~/server/app-layer/scheduler/scheduler.service.ts` is the most likely
 * home, exactly as billing's own sweep names.
 */
export interface ContributionSweepMount {
  readonly name: typeof CONTRIBUTION_SWEEP_NAME;
  readonly intervalMs: number;
  readonly run: () => Promise<ContributionSweepOutcome>;
}

/** How often the sweep runs — wide enough that the pokes carry normal-case latency, tight enough that a lost poke's gap is bounded. */
export const CONTRIBUTION_SWEEP_INTERVAL_MS = 15 * 60 * 1000;

export function createContributionSweepMount(
  deps: ContributionSweepDeps,
): ContributionSweepMount {
  return {
    name: CONTRIBUTION_SWEEP_NAME,
    intervalMs: CONTRIBUTION_SWEEP_INTERVAL_MS,
    run: runContributionSweep(deps),
  };
}
