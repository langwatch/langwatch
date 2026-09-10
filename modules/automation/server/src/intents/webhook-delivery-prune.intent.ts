import { createLogger } from "@langwatch/observability";
import { z } from "zod";
import type { AutomationIntentRetention } from "../repositories/automation-intent-retention.repository.ts";
import type { AutomationScheduledIntent } from "../services/automation-scheduled-intent.service.ts";

const logger = createLogger("langwatch:automation:webhook-delivery-prune");
const PRUNE_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const webhookDeliveryPruneIntentSchema = z.object({
  scheduledFor: z.number().int(),
});

export function runWebhookDeliveryPrune(
  scheduledIntents: AutomationScheduledIntent,
  retention: AutomationIntentRetention,
) {
  return async (input: z.infer<typeof webhookDeliveryPruneIntentSchema>): Promise<void> => {
    const deleted = await scheduledIntents.pruneWebhookDeliveries();
    if (deleted > 0) {
      logger.info({ deleted }, "Webhook delivery log pruned");
    }
    await retention.deleteDispatchedBefore({
      processName: "webhookDeliveryPrune",
      before: input.scheduledFor - PRUNE_ROW_RETENTION_MS,
    });
  };
}
