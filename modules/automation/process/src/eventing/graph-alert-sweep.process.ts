import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { graphAlertSweepIntentSchema } from "./graph-alert-sweep.intent.ts";

export const GRAPH_ALERT_SWEEP_PROCESS_NAME = "graphAlertSweep" as const;
export const GRAPH_ALERT_SWEEP_INTERVAL_MS = 30_000;

export const sweepSchema = graphAlertSweepIntentSchema;

export const graphAlertSweepStateSchema = z.object({
  lastSweepAt: z.number().nullable(),
});
export type GraphAlertSweepState = z.infer<typeof graphAlertSweepStateSchema>;

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
