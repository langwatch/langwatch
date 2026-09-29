import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import {
  WORKFLOW_CREATED_EVENT_TYPE,
  WORKFLOW_CREATED_EVENT_VERSION,
  type WorkflowCreatedEvent,
} from "../workflow-lifecycle.events.ts";
import { buildWorkflowLifecyclePipeline } from "../workflow-lifecycle.pipeline.ts";

const event: WorkflowCreatedEvent = {
  id: "event-1",
  aggregateId: "workflow-1",
  aggregateType: "workflow",
  tenantId: createTenantId("project-1"),
  createdAt: 1_700_000_000_000,
  occurredAt: 1_700_000_000_000,
  type: WORKFLOW_CREATED_EVENT_TYPE,
  version: WORKFLOW_CREATED_EVENT_VERSION,
  data: { workflowId: "workflow-1", projectId: "project-1", userId: "user-1", workflowCount: 1 },
};

const context = { tenantId: "project-1", aggregateId: "workflow-1" };

/** Nurturing as it behaves: one signal per kind and source event, however often it is told. */
function nurturing() {
  const signals = new Map<string, NurturingSignal>();
  return {
    signals,
    recordSignal: async (signal: NurturingSignal) => {
      signals.set(`${signal.kind}:${signal.sourceEventId}`, signal);
    },
  };
}

describe("the workflow-created nurturing subscriber on redelivery", () => {
  it("tells nurturing one signal when the same event is handled twice", async () => {
    const target = nurturing();
    const subscriber = buildWorkflowLifecyclePipeline(target).eventSubscribers.get(
      "workflowCreatedNurturing",
    );
    if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");

    await subscriber.handle(event, context);
    await subscriber.handle(event, context);

    expect([...target.signals.values()]).toEqual([
      {
        kind: "workflow_created",
        sourceEventId: "event-1",
        tenantId: "project-1",
        occurredAt: 1_700_000_000_000,
        workflowId: "workflow-1",
        projectId: "project-1",
        userId: "user-1",
        workflowCount: 1,
      },
    ]);
  });
});
