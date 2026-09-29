import type { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import type { SubscriberSpec } from "@langwatch/eventing";

import {
  WORKFLOW_CREATED_EVENT_TYPE,
  type WorkflowLifecycleEvent,
} from "./workflow-lifecycle.events.ts";

export type WorkflowCreatedNurturingDeps = Pick<NurturingApi, "recordSignal">;

/** Tells nurturing a workflow was created (§9); it sends the signal once per event. */
export function createWorkflowCreatedNurturingSubscriber(
  nurturing: WorkflowCreatedNurturingDeps,
): SubscriberSpec<WorkflowLifecycleEvent> & { fold?: never; map?: never } {
  return {
    events: [WORKFLOW_CREATED_EVENT_TYPE],
    handler: (event: WorkflowLifecycleEvent) =>
      nurturing.recordSignal({
        kind: "workflow_created",
        sourceEventId: event.id,
        tenantId: String(event.tenantId),
        occurredAt: event.occurredAt,
        ...event.data,
      }),
  };
}
