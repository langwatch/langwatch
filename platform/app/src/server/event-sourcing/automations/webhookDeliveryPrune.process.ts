import type {
  EvolveStep,
  IntentDef,
  ProcessContext,
  ProcessManagerHandlerMap,
} from "@langwatch/event-sourcing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { automationsEvents } from "./events";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "./triggerSettlement.process";

const logger = createLogger("langwatch:automations:webhook-delivery-prune");

export const WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME =
  "webhookDeliveryPrune" as const;
export const WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** This process wakes daily, so its own dispatched outbox rows are kept a
 *  week — long enough to read back a failed prune's history. */
const PRUNE_OUTBOX_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SETTLEMENT_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

export const webhookDeliveryPruneStateSchema = z.object({
  lastPruneAt: z.number().nullable(),
  /** See `graphAlertSweepStateSchema.nextWakeAt` — same reasoning: the only
   *  way an `.on()` handler this process needs just to exist can leave the
   *  armed deadline untouched is by reading it back from state. */
  nextWakeAt: z.number().nullable(),
});
export type WebhookDeliveryPruneState = z.infer<
  typeof webhookDeliveryPruneStateSchema
>;

export function initWebhookDeliveryPruneState(): WebhookDeliveryPruneState {
  return { lastPruneAt: null, nextWakeAt: null };
}

export const prunePayloadSchema = z.object({ scheduledFor: z.number().int() });
export type PrunePayload = z.infer<typeof prunePayloadSchema>;

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

async function pruneDispatchedOutbox({
  ports,
  processName,
  scheduledFor,
  retentionMs,
}: {
  ports: WebhookDeliveryPrunePorts;
  processName: string;
  scheduledFor: number;
  retentionMs: number;
}): Promise<void> {
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

/**
 * A singleton, schedule-only process manager keeping the webhook delivery log
 * bounded (ADR-040 §6). It also carries `triggerSettlement`'s outbox
 * retention: that process is keyed per trigger and only wakes when it has
 * pending matches, so pruning from its own wake would fire a global,
 * cross-tenant delete from every trigger at once.
 */
function createPruneIntent(
  ports: WebhookDeliveryPrunePorts,
): IntentDef<typeof prunePayloadSchema> {
  return {
    payload: prunePayloadSchema,
    messageKey: (payload) => `prune:${payload.scheduledFor}`,
    async deliver(payload) {
      const deleted = await ports.pruneExpiredDeliveries();
      if (deleted > 0) {
        logger.info({ deleted }, "Webhook delivery log pruned");
      }

      await pruneDispatchedOutbox({
        ports,
        processName: WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
        scheduledFor: payload.scheduledFor,
        retentionMs: PRUNE_OUTBOX_RETENTION_MS,
      });
      await pruneDispatchedOutbox({
        ports,
        processName: TRIGGER_SETTLEMENT_PROCESS_NAME,
        scheduledFor: payload.scheduledFor,
        retentionMs: SETTLEMENT_OUTBOX_RETENTION_MS,
      });
    },
  };
}

export function webhookDeliveryPruneIntents(ports: WebhookDeliveryPrunePorts) {
  return { prune: createPruneIntent(ports) };
}

type WebhookDeliveryPruneIntents = ReturnType<
  typeof webhookDeliveryPruneIntents
>;

export const webhookDeliveryPruneOn: ProcessManagerHandlerMap<
  typeof automationsEvents,
  WebhookDeliveryPruneState,
  WebhookDeliveryPruneIntents
> = {
  matchRecorded(
    state,
  ): EvolveStep<WebhookDeliveryPruneState, WebhookDeliveryPruneIntents> {
    return { state, intents: [], nextWakeAt: state.nextWakeAt };
  },
};

export function webhookDeliveryPruneOnWake(
  state: WebhookDeliveryPruneState,
  ctx: ProcessContext,
): EvolveStep<WebhookDeliveryPruneState, WebhookDeliveryPruneIntents> {
  const nextWakeAt = ctx.now + WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS;
  return {
    state: { lastPruneAt: ctx.now, nextWakeAt },
    intents: [{ type: "prune", payload: { scheduledFor: ctx.now } }],
    nextWakeAt,
  };
}
