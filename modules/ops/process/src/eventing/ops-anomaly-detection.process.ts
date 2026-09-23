import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Once a minute, as main's anomaly worker ticked; a wake now runs once across the fleet. */
export const ANOMALY_DETECTION_INTERVAL_MS = 60_000;

export const anomalyDetectionSchema = z.object({
  scheduledFor: z.number().int(),
});

export interface AnomalyDetectionState {
  lastDetectionAt: number | null;
}

export const ANOMALY_DETECTION_INITIAL_STATE: AnomalyDetectionState = {
  lastDetectionAt: null,
};

export type AnomalyDetectionIntents = {
  detect: IntentSpec<typeof anomalyDetectionSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for its tick once. */
export const anomalyDetectionWake: WakeHandler<AnomalyDetectionState, AnomalyDetectionIntents> = (
  _state,
  ctx,
) => ({
  state: { lastDetectionAt: ctx.at },
  intents: [ctx.intents.detect(`detect:${ctx.at}`, { scheduledFor: ctx.at })],
});
