import { defineProcess } from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { IntentHandler } from "../intentDispatch";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "./triggerSettlement";

const logger = createLogger("langwatch:automations:webhook-delivery-prune");

export const WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME =
  "webhookDeliveryPrune" as const;
export const WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TRIGGER_SETTLEMENT_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface WebhookDeliveryPrunePorts {
  /** Deletes webhook delivery-log rows past the retention bound; returns the
   *  row count. */
  pruneExpiredDeliveries(): Promise<number>;
  /** Deletes dispatched outbox rows older than `before` for one process. */
  pruneDispatchedIntentsBefore(params: {
    processName: string;
    before: number;
  }): Promise<number>;
}

/**
 * A singleton, schedule-only process manager (ADR-098 decision 1, ADR-040 §6)
 * keeping the webhook delivery log bounded.
 *
 * It also carries `triggerSettlement`'s outbox retention: that process is
 * keyed per trigger and only wakes when it has pending matches, so pruning
 * from its own wake would fire a global, cross-tenant delete from every
 * trigger at once.
 */
export const webhookDeliveryPrune = defineProcess(
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
)
  .state(z.object({ lastPruneAt: z.number().nullable() }), () => ({
    lastPruneAt: null as number | null,
  }))
  .intents({
    prune: {
      payload: z.object({ scheduledFor: z.number().int() }),
      messageKey: (payload) => `prune:${payload.scheduledFor}`,
    },
  })
  .schedule({ everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS })
  .onWake((_state, intents, ctx) => ({
    state: { lastPruneAt: ctx.at },
    intents: [intents.prune({ scheduledFor: ctx.at })],
  }))
  .build();

export type WebhookDeliveryPruneState = ReturnType<
  typeof webhookDeliveryPrune.init
>;
export type PruneIntent = Parameters<
  typeof webhookDeliveryPrune.intents.prune
>[0];

/** Deletes expired webhook deliveries, then best-effort prunes both processes'
 *  dispatched outbox rows. Losing a day of retention cleanup is recoverable at
 *  the next wake; losing today's webhook-log prune to a retention error is
 *  not. */
export function createPruneHandler(
  ports: WebhookDeliveryPrunePorts,
): IntentHandler<PruneIntent> {
  return async (payload) => {
    const deleted = await ports.pruneExpiredDeliveries();
    if (deleted > 0) {
      logger.info({ deleted }, "Webhook delivery log pruned");
    }

    await pruneOwnOutbox(
      ports,
      WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
      payload.scheduledFor,
      WEBHOOK_LOG_RETENTION_MS,
    );
    await pruneOwnOutbox(
      ports,
      TRIGGER_SETTLEMENT_PROCESS_NAME,
      payload.scheduledFor,
      TRIGGER_SETTLEMENT_OUTBOX_RETENTION_MS,
    );
  };
}

async function pruneOwnOutbox(
  ports: WebhookDeliveryPrunePorts,
  processName: string,
  scheduledFor: number,
  retentionMs: number,
): Promise<void> {
  try {
    await ports.pruneDispatchedIntentsBefore({
      processName,
      before: scheduledFor - retentionMs,
    });
  } catch (error) {
    logger.warn(
      {
        processName,
        error: error instanceof Error ? error.message : String(error),
      },
      "Outbox retention prune failed",
    );
  }
}
