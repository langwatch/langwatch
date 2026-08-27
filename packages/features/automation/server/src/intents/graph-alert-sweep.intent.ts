import { createLogger } from "@langwatch/observability";
import type { GraphTriggerSweepCandidate } from "@langwatch/automation-contract";
import { z } from "zod";
import type { AutomationIntentRetentionPort } from "../ports/automation-intent-retention.port";
import type { AutomationScheduledIntentPort } from "../ports/automation-scheduled-intent.port";

const logger = createLogger("langwatch:automation:graph-alert-sweep");
const SWEEP_ROW_RETENTION_MS = 24 * 60 * 60 * 1000;

export const graphAlertSweepIntentSchema = z.object({
  scheduledFor: z.number().int(),
});

export function runGraphAlertSweep(
  scheduledIntents: AutomationScheduledIntentPort,
  retention: AutomationIntentRetentionPort,
) {
  return async (input: z.infer<typeof graphAlertSweepIntentSchema>): Promise<void> => {
    const startedAt = input.scheduledFor;
    const candidates = await scheduledIntents.decideGraphTriggerHeartbeat({
      now: new Date(startedAt),
    });
    const failures: GraphTriggerSweepCandidate[] = [];
    for (const candidate of candidates) {
      try {
        await scheduledIntents.evaluateGraphTrigger(candidate);
      } catch (error) {
        failures.push(candidate);
        logger.warn(
          {
            projectId: candidate.projectId,
            triggerId: candidate.triggerId,
            reason: candidate.reason,
            error: error instanceof Error ? error.message : String(error),
          },
          "Graph-alert sweep candidate failed; retrying the durable intent",
        );
      }
    }
    await retention.deleteDispatchedBefore({
      processName: "graphAlertSweep",
      before: startedAt - SWEEP_ROW_RETENTION_MS,
    });
    if (failures.length > 0) {
      throw new Error(
        `Graph-alert sweep failed for ${failures.length}/${candidates.length} candidates`,
      );
    }
  };
}
