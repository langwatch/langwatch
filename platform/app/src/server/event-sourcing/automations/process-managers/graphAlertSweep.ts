import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { defineProcessManager, type IntentContext, type WakeStep } from "./defineProcessManager";

const logger = createLogger("langwatch:automations:graph-alert-sweep");

/**
 * `graphAlertSweep`: a singleton, schedule-only process manager (ADR-098
 * decision 1) that backstops the real-time graph-trigger path
 * (`subscribers/graphTriggerActivity.subscriber.ts`).
 *
 * The real-time subscriber is at-most-once — a burst of trace activity
 * evaluates a project's graph triggers, but if that job is lost the trigger
 * simply doesn't get re-checked until more activity arrives. Two situations
 * need something that runs regardless of activity: a "no data" alert (its
 * whole point is firing on the ABSENCE of traces, which never generates an
 * activity event to react to) and a lost real-time job. This process owns
 * both by sweeping every project's graph triggers on a fixed interval,
 * independent of any trace pipeline's event stream — which is also why it
 * declares no event handlers at all and is keyed globally rather than per
 * aggregate (`groupKeys.ts`).
 */

export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;

export interface GraphAlertSweepState {
  readonly lastSweepAt: number | null;
}

/** One project's graph trigger, due for a heartbeat evaluation. */
export interface GraphAlertSweepCandidate {
  readonly triggerId: string;
  readonly projectId: string;
  readonly reason: "heartbeat";
}

export interface GraphAlertSweepPorts {
  /** Every graph trigger due for a heartbeat sweep right now — a project
   *  whose real-time path is already firing is the sweep's own job to skip,
   *  not this pipeline's (the port owns that decision; see
   *  `specs/automations/process-manager-dispatch.feature`). */
  decideSweepCandidates(params: {
    now: Date;
  }): Promise<readonly GraphAlertSweepCandidate[]>;
  evaluateGraphTrigger(candidate: GraphAlertSweepCandidate): Promise<void>;
}

const intentSchemas = {
  evaluateGraph: z.object({ scheduledFor: z.number().int() }),
};
type Intents = typeof intentSchemas;
export type SweepIntent = z.infer<Intents["evaluateGraph"]>;

/** Every wake emits exactly one `evaluateGraph` intent, keyed on the wake
 *  instant — a redelivered wake for the same instant collapses onto the
 *  same intent instead of re-sweeping. */
const onWake: WakeStep<GraphAlertSweepState, Intents> = (_state, ctx) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.evaluateGraph(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});

/** The one declaration — intent type strings are the keys of `intentSchemas`
 *  above, inferred; nothing here names `"evaluateGraph"` a second time. */
export const graphAlertSweepDefinition = defineProcessManager(GRAPH_ALERT_SWEEP_PROCESS_NAME)
  .state(
    z.object({ lastSweepAt: z.number().nullable() }),
    (): GraphAlertSweepState => ({ lastSweepAt: null }),
  )
  .intents(intentSchemas)
  .schedule({ everyMs: GRAPH_ALERT_SWEEP_INTERVAL_MS })
  .onWake(onWake);

/** The `evaluateGraph` intent handler: sweeps every due candidate, isolating
 *  one candidate's failure from the rest so a single project's evaluation
 *  error never stalls the whole sweep. */
export function createEvaluateGraphHandler(ports: GraphAlertSweepPorts) {
  return async (payload: SweepIntent, _ctx: IntentContext): Promise<void> => {
    const candidates = await ports.decideSweepCandidates({
      now: new Date(payload.scheduledFor),
    });
    let failures = 0;
    for (const candidate of candidates) {
      try {
        await ports.evaluateGraphTrigger(candidate);
      } catch (error) {
        failures++;
        logger.error(
          {
            projectId: candidate.projectId,
            triggerId: candidate.triggerId,
            reason: candidate.reason,
            error: error instanceof Error ? error.message : String(error),
          },
          "Graph-alert sweep candidate failed; the next sweep retries it",
        );
      }
    }
    if (failures > 0) {
      logger.warn(
        { failures, candidates: candidates.length },
        "Graph-alert sweep completed with isolated candidate failures",
      );
    }
  };
}
