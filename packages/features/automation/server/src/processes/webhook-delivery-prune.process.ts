import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { webhookDeliveryPruneIntentSchema } from "../intents/webhook-delivery-prune.intent";

export const WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME = "webhookDeliveryPrune" as const;
/** ADR-040 §6: the delivery log is bounded at 30 days; one prune a day keeps
 *  it there. Runs in-process on the worker (scheduled process manager) — the
 *  K8s CronJob that used to curl `/api/cron/webhook_delivery_cleanup` was
 *  removed along with the rest of the automations cron machinery.
 *
 *  Both webhook channels share one log and one sweep now, so this wake and the
 *  endpoints platform's hourly maintenance run the same statement. They are
 *  kept as two schedules because they cover different installs: this one is a
 *  guaranteed daily wake, while the platform's rides the delivery hot path and
 *  therefore never fires on an install with automations webhooks and no
 *  gateway traffic. The sweep is a single idempotent delete, so running it
 *  from both costs one no-op statement. */
export const WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const pruneSchema = webhookDeliveryPruneIntentSchema;

export interface WebhookDeliveryPruneState {
  lastPruneAt: number | null;
}

type PruneIntents = {
  prune: IntentSpec<typeof pruneSchema>;
};

export const webhookDeliveryPruneWake: WakeHandler<WebhookDeliveryPruneState, PruneIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intents.prune(`prune:${ctx.at}`, { scheduledFor: ctx.at })],
});
