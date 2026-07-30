import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import { defineProcessManager, type IntentContext, type WakeStep } from "./defineProcessManager";
import { TRIGGER_SETTLEMENT_PROCESS_NAME } from "./triggerSettlement";

const logger = createLogger("langwatch:automations:webhook-delivery-prune");

/**
 * `webhookDeliveryPrune`: a singleton, schedule-only process manager
 * (ADR-098 decision 1, ADR-040 §6) that keeps the webhook delivery log
 * bounded — one prune a day, running in-process on the worker rather than
 * as an external cron hitting an HTTP endpoint.
 *
 * It also carries `triggerSettlement`'s own outbox-retention housekeeping.
 * `triggerSettlement` is keyed per trigger and only wakes when it has
 * pending matches (`groupKeys.ts`), so it has no singleton schedule of its
 * own to hang retention off; pruning it from every individual trigger's
 * wake would fire a global, cross-tenant delete from each one — a
 * thundering herd. Piggybacking on this process's existing daily wake
 * reuses the same "the singleton PM already has a schedule" mechanism
 * `graphAlertSweep` uses for itself, applied to a sibling with no schedule
 * of its own.
 */

export const WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME = "webhookDeliveryPrune" as const;
export const WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WEBHOOK_LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const TRIGGER_SETTLEMENT_OUTBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface WebhookDeliveryPruneState {
  readonly lastPruneAt: number | null;
}

export interface WebhookDeliveryPrunePorts {
  /** Deletes webhook delivery-log rows older than the retention bound;
   *  returns the row count. */
  pruneExpiredDeliveries(): Promise<number>;
  /**
   * Deletes dispatched (already-acknowledged) outbox rows older than
   * `before` for one process, returning the row count. This is a hook onto
   * the future executor's outbox retention (`defineProcessManager.ts`'s
   * docblock) — there is no outbox table yet for it to prune, so a
   * composition root wiring this port today has nothing real to point it
   * at. The port is kept anyway because the BEHAVIOUR (bounded outbox
   * rows, piggybacked here for `triggerSettlement`) is part of what this
   * rewrite preserves, even though its implementation waits on the
   * executor.
   */
  pruneDispatchedIntentsBefore(params: {
    processName: string;
    before: number;
  }): Promise<number>;
}

const intentSchemas = {
  prune: z.object({ scheduledFor: z.number().int() }),
};
type Intents = typeof intentSchemas;
export type PruneIntent = z.infer<Intents["prune"]>;

const onWake: WakeStep<WebhookDeliveryPruneState, Intents> = (_state, ctx) => ({
  state: { lastPruneAt: ctx.at },
  intents: [ctx.intents.prune(`prune:${ctx.at}`, { scheduledFor: ctx.at })],
});

/** The one declaration — `"prune"` is authored exactly once, as a key of
 *  `intentSchemas`. */
export const webhookDeliveryPruneDefinition = defineProcessManager(
  WEBHOOK_DELIVERY_PRUNE_PROCESS_NAME,
)
  .state(
    z.object({ lastPruneAt: z.number().nullable() }),
    (): WebhookDeliveryPruneState => ({ lastPruneAt: null }),
  )
  .intents(intentSchemas)
  .schedule({ everyMs: WEBHOOK_DELIVERY_PRUNE_INTERVAL_MS })
  .onWake(onWake);

/** The `prune` intent handler: deletes expired webhook deliveries, then
 *  best-effort prunes both processes' own dispatched outbox rows. Neither
 *  retention delete failing fails the prune itself — losing a day of
 *  retention cleanup is recoverable at the next wake; losing today's actual
 *  webhook-log prune to a retention-delete error would not be. */
export function createPruneHandler(ports: WebhookDeliveryPrunePorts) {
  return async (payload: PruneIntent, _ctx: IntentContext): Promise<void> => {
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
      { processName, error: error instanceof Error ? error.message : String(error) },
      "Outbox retention prune failed",
    );
  }
}
