import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Every five minutes: a route first seen is recorded soon after, and a repeat writes nothing. */
export const PRIVATE_DATAPLANE_RECORD_INTERVAL_MS = 5 * 60 * 1000;

export const privateDataplaneRecordSchema = z.object({
  scheduledFor: z.number().int(),
});

export const privateDataplaneRecorderStateSchema = z.object({
  lastRecordedAt: z.number().nullable(),
});
type PrivateDataplaneRecorderState = z.infer<typeof privateDataplaneRecorderStateSchema>;

export const PRIVATE_DATAPLANE_RECORDER_INITIAL_STATE: PrivateDataplaneRecorderState = {
  lastRecordedAt: null,
};

type PrivateDataplaneRecorderIntents = {
  record: IntentSpec<typeof privateDataplaneRecordSchema>;
};

/** Keyed by the wake, so a redelivered wake asks for its record once. */
export const privateDataplaneRecorderWake: WakeHandler<
  PrivateDataplaneRecorderState,
  PrivateDataplaneRecorderIntents
> = (_state, ctx) => ({
  state: { lastRecordedAt: ctx.at },
  intents: [ctx.intent("record", `record:${ctx.at}`, { scheduledFor: ctx.at })],
});
