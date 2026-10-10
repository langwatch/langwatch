import type { EventSubscriberDefinition } from "@langwatch/eventing";

import { EXPERIMENT_RUN_EVENT_TYPES } from "../rules/experiment-run-event-types.rules.ts";
import type {
  ExperimentRunProcessingEvent,
  WorkflowEvaluationRequestedEventData,
} from "./experiment-run-events.process.ts";

/** What runs a requested workflow evaluation to its end, on the worker that drains the pipeline. */
export type WorkflowEvaluationRunner = Readonly<{
  run(request: WorkflowEvaluationRequestedEventData & { tenantId: string }): Promise<void>;
}>;

export function createWorkflowEvaluationRequestedSubscriber(
  runner: WorkflowEvaluationRunner,
): EventSubscriberDefinition<ExperimentRunProcessingEvent> {
  return {
    name: "workflowEvaluationRequested",
    eventTypes: [EXPERIMENT_RUN_EVENT_TYPES.WORKFLOW_EVALUATION_REQUESTED],
    handle: async (event) => {
      if (event.type !== EXPERIMENT_RUN_EVENT_TYPES.WORKFLOW_EVALUATION_REQUESTED) return;

      await runner.run({ ...event.data, tenantId: event.tenantId });
    },
  };
}
