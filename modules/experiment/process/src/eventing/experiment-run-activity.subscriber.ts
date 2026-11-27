import type { EventSubscriberDefinition } from "@langwatch/eventing";

import { EXPERIMENT_RUN_EVENT_TYPES } from "../rules/experiment-run-event-types.rules.ts";
import type { ExperimentRunProcessingEvent } from "./experiment-run-events.process.ts";

/** What records a run as active from its start until its completion. */
export type ExperimentRunActivityRecorder = Readonly<{
  recordStarted(input: { projectId: string; runId: string; startedAt: number }): Promise<void>;
  recordCompleted(input: { projectId: string; runId: string }): Promise<void>;
}>;

/** A planned run counts toward the default concurrency of the runs after it until it completes. */
export function createExperimentRunActivitySubscriber(
  recorder: ExperimentRunActivityRecorder,
): EventSubscriberDefinition<ExperimentRunProcessingEvent> {
  return {
    name: "experimentRunActivity",
    eventTypes: [EXPERIMENT_RUN_EVENT_TYPES.STARTED, EXPERIMENT_RUN_EVENT_TYPES.COMPLETED],
    handle: async (event) => {
      const projectId = String(event.tenantId);
      if (event.type === EXPERIMENT_RUN_EVENT_TYPES.STARTED) {
        // An SDK's run sends no plan and runs no cells here.
        if (!event.data.plan) return;
        await recorder.recordStarted({
          projectId,
          runId: event.data.runId,
          startedAt: event.occurredAt,
        });
        return;
      }
      if (event.type === EXPERIMENT_RUN_EVENT_TYPES.COMPLETED) {
        await recorder.recordCompleted({ projectId, runId: event.data.runId });
      }
    },
  };
}
