import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

import { webhookDeliveryPruneIntentSchema } from "./webhook-delivery-prune.intent.ts";

export const WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME = "webhookDeliveryPrune" as const;
// ADR-040 §6: prune the delivery log daily; runs in-process and is idempotent.
export const WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const pruneSchema = webhookDeliveryPruneIntentSchema;

export const webhookDeliveryPruneStateSchema = z.object({
  lastPruneAt: z.number().nullable(),
});
export type WebhookDeliveryPruneState = z.infer<typeof webhookDeliveryPruneStateSchema>;

type PruneIntents = {
  prune: IntentSpec<typeof pruneSchema>;
};

export const webhookDeliveryPruneWake: WakeHandler<WebhookDeliveryPruneState, PruneIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent("prune", `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
