import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { ProcessManagerApplier } from "~/server/event-sourcing/pipeline/processBuilder";
import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { AutomationEvent } from "~/server/event-sourcing/pipelines/automations/schemas/events";

const logger = createLogger("langwatch:triggers:webhook-delivery-prune");

export const WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME =
  "webhookDeliveryPrune" as const;
/** ADR-040 §6: the delivery log is bounded at 30 days; one prune a day keeps
 *  it there. Runs in-process on the worker (scheduled process manager) — the
 *  K8s CronJob that used to curl `/api/cron/webhook_delivery_cleanup` was
 *  removed along with the rest of the automations cron machinery. */
export const WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PRUNE_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const pruneSchema = z.object({ scheduledFor: z.number().int() });

export interface WebhookDeliveryPruneState {
  lastPruneAt: number | null;
}

export interface WebhookDeliveryPruneDeps {
  /** Deletes delivery rows older than the 30-day bound; returns row count. */
  pruneExpired: () => Promise<number>;
  deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  now?: () => number;
}

type PruneIntents = {
  prune: IntentSpec<typeof pruneSchema>;
};

const wake: WakeHandler<WebhookDeliveryPruneState, PruneIntents> = (
  _state,
  ctx,
) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intents.prune(`prune:${ctx.at}`, { scheduledFor: ctx.at })],
});

function runPrune(deps: WebhookDeliveryPruneDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const deleted = await deps.pruneExpired();
    if (deleted > 0) {
      logger.info({ deleted }, "Webhook delivery log pruned");
    }
    try {
      await deps.deleteDispatchedBefore({
        processName: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
        before: startedAt - PRUNE_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Webhook delivery prune outbox retention failed",
      );
    }
  };
}

export const webhookDeliveryPrunePM = (
  deps: WebhookDeliveryPruneDeps,
): ProcessManagerApplier<AutomationEvent> =>
  (pm) =>
    pm
      .state<WebhookDeliveryPruneState>({ lastPruneAt: null })
      .schedule({ everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS })
      .onWake(wake)
      .intent("prune", pruneSchema, runPrune(deps));
