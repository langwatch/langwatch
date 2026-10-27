import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:webhooks:delivery-prune");

/** Main's name, kept: a guaranteed daily wake so the 30-day prune runs with no delivery traffic. */
export const WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME = "webhookDeliveryPrune";
export const WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRUNE_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const webhookDeliveryPruneSchema = z.object({ scheduledFor: z.number().int() });

export const webhookDeliveryPruneStateSchema = z.object({
  lastPruneAt: z.number().nullable(),
});
type WebhookDeliveryPruneState = z.infer<typeof webhookDeliveryPruneStateSchema>;

export const WEBHOOK_DELIVERY_PRUNE_INITIAL_STATE: WebhookDeliveryPruneState = {
  lastPruneAt: null,
};

type WebhookDeliveryPruneIntents = {
  prune: IntentSpec<typeof webhookDeliveryPruneSchema>;
};

export const webhookDeliveryPruneWake: WakeHandler<
  WebhookDeliveryPruneState,
  WebhookDeliveryPruneIntents
> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intent("prune", `prune:${ctx.at}`, { scheduledFor: ctx.at })],
});

export interface WebhookDeliveryPruneDeps {
  /** The maintenance sweep: outbox, delivery log past 30 days, expired receipts. */
  prune: () => Promise<void>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runWebhookDeliveryPrune(deps: WebhookDeliveryPruneDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    await deps.prune();
    try {
      await deps.deleteDispatchedBefore({
        processName: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
        before: startedAt - PRUNE_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn({ error }, "webhook delivery prune outbox retention failed");
    }
  };
}
