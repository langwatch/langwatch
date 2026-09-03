import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { graphAlertSweepIntentSchema } from "../intents/graph-alert-sweep.intent";

export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;

export const sweepSchema = graphAlertSweepIntentSchema;

export interface GraphAlertSweepState {
  lastSweepAt: number | null;
}

type SweepIntents = {
  evaluateGraph: IntentSpec<typeof sweepSchema>;
};

export const graphAlertSweepWake: WakeHandler<GraphAlertSweepState, SweepIntents> = (
  _state,
  ctx,
) => ({
  state: { lastSweepAt: ctx.at },
  intents: [ctx.intents.evaluateGraph(`sweep:${ctx.at}`, { scheduledFor: ctx.at })],
});
