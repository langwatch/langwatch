import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type {
  IntentSpec,
  WakeHandler,
} from "~/server/event-sourcing/pipeline/processManagerDefinition";

import { toSafeFailureDiagnostic } from "../../../process-manager/failureDiagnostic";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "./triggerSettlement.process";

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

export const webhookDeliveryPruneWake: WakeHandler<
  WebhookDeliveryPruneState,
  PruneIntents
> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intents.prune(`prune:${ctx.at}`, { scheduledFor: ctx.at })],
});

export function runWebhookDeliveryPrune(deps: WebhookDeliveryPruneDeps) {
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

/** triggerSettlement is keyed per-trigger (aggregateType "trigger") and only
 *  wakes when it has pending matches, so — unlike graphAlertSweep/
 *  webhookDeliveryPrune — it has no singleton schedule of its own to hang
 *  outbox retention off. Pruning it from its own onWake would fire a global
 *  cross-tenant delete from every single trigger's wake (a thundering herd),
 *  so instead we piggyback on webhookDeliveryPrune's existing daily wake —
 *  the same singleton-PM retention mechanism sweep/prune already use for
 *  themselves — to also prune triggerSettlement's dispatched outbox rows,
 *  the highest-volume PM in that pipeline. */
const TRIGGER_SETTLEMENT_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

function runWebhookDeliveryPruneWithTriggerSettlementRetention(
  deps: WebhookDeliveryPruneDeps,
) {
  const pruneWebhookDeliveries = runWebhookDeliveryPrune(deps);
  return async (): Promise<void> => {
    await pruneWebhookDeliveries();
    const startedAt = (deps.now ?? Date.now)();
    try {
      await deps.deleteDispatchedBefore({
        processName: TRIGGER_SETTLEMENT_PROCESS_NAME,
        before: startedAt - TRIGGER_SETTLEMENT_OUTBOX_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        toSafeFailureDiagnostic(error),
        "triggerSettlement outbox retention failed",
      );
    }
  };
}

/**
 * The `webhookDeliveryPrune` process-manager topology, exported standalone so
 * the pipeline mounts one expression of it and tests can build the exact
 * definition the runtime runs. `automations/pipeline.ts` mounts it as
 * `.withProcessManager(WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
 * webhookDeliveryPrunePM(deps.prune))`.
 *
 * Its daily wake carries triggerSettlement's outbox retention too — see the
 * note above.
 */
export function webhookDeliveryPrunePM(
  deps: WebhookDeliveryPruneDeps,
): ProcessManagerApplier<AutomationEvent> {
  return (pm) =>
    pm
      .state<WebhookDeliveryPruneState>({ lastPruneAt: null })
      .schedule({ everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS })
      .onWake(webhookDeliveryPruneWake)
      .intent(
        "prune",
        pruneSchema,
        runWebhookDeliveryPruneWithTriggerSettlementRetention(deps),
      );
}
