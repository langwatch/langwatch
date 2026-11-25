import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/** Every 15 minutes, the length of one upload window: an abandoned upload's bytes go within two. */
export const UPLOAD_REAP_INTERVAL_MS = 15 * 60 * 1000;

export const uploadReapSchema = z.object({
  scheduledFor: z.number().int(),
});

export const uploadReapStateSchema = z.object({
  lastReapAt: z.number().nullable(),
});
type UploadReapState = z.infer<typeof uploadReapStateSchema>;

export const UPLOAD_REAP_INITIAL_STATE: UploadReapState = {
  lastReapAt: null,
};

type UploadReapIntents = {
  reap: IntentSpec<typeof uploadReapSchema>;
};

/** Pure and synchronous; the reap itself runs behind the outbox lease. */
export const uploadReapWake: WakeHandler<UploadReapState, UploadReapIntents> = (_state, ctx) => ({
  state: { lastReapAt: ctx.at },
  intents: [ctx.intent("reap", `reap:${ctx.at}`, { scheduledFor: ctx.at })],
});
