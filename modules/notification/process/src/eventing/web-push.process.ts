import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import type { webPushSendSchema } from "../services/web-push.service.ts";

export const WEB_PUSH_PROCESS_NAME = "notificationWebPush";

/** The send intent's type, as queued rows name it. */
export const WEB_PUSH_SEND_INTENT = "send";

/** One key per person: the outbox sends a person's pushes in order, and others in parallel. */
export function webPushProcessKey(userId: string): string {
  return `user:${userId}`;
}

/** Sent and dead rows are kept this long, then pruned. */
export const WEB_PUSH_OUTBOX_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

/** How often the prune runs. */
export const WEB_PUSH_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const webPushPruneSchema = z.object({ scheduledFor: z.number().int() });

export const webPushProcessStateSchema = z.object({ lastPruneAt: z.number().nullable() });
type WebPushProcessState = z.infer<typeof webPushProcessStateSchema>;

export const WEB_PUSH_INITIAL_STATE: WebPushProcessState = { lastPruneAt: null };

type WebPushIntents = {
  send: IntentSpec<typeof webPushSendSchema>;
  prune: IntentSpec<typeof webPushPruneSchema>;
};

/** The daily wake prunes the outbox rows the sends left behind. */
export const webPushPruneWake: WakeHandler<WebPushProcessState, WebPushIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent("prune", `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
