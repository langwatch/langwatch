/**
 * A created workflow is recorded on workflow's own pipeline, and the worker's
 * subscriber tells nurturing. @see specs/features/customer-io-nurturing-integration.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { RecordWorkflowCreatedCommand } from "../workflow-lifecycle.commands.ts";
import {
  WORKFLOW_CREATED_EVENT_TYPE,
  WORKFLOW_CREATED_EVENT_VERSION,
  type WorkflowCreatedEvent,
} from "../workflow-lifecycle.events.ts";
import { buildWorkflowLifecyclePipeline } from "../workflow-lifecycle.pipeline.ts";

const created = {
  workflowId: "workflow-1",
  projectId: "project-1",
  userId: "user-1",
  workflowCount: 3,
};

function createdEvent(): WorkflowCreatedEvent {
  const [event] = new RecordWorkflowCreatedCommand().handle({
    tenantId: createTenantId("project-1"),
    type: "lw.workflow.record_created",
    aggregateId: created.workflowId,
    data: { tenantId: "project-1", occurredAt: 1_700_000_000_000, ...created },
  });
  if (!event) throw new Error("the command recorded no event");
  return event;
}

describe("the workflow lifecycle pipeline", () => {
  describe("when the record-created command is handled", () => {
    it("appends one workflow_created event keyed by the workflow", () => {
      expect(createdEvent()).toMatchObject({
        type: WORKFLOW_CREATED_EVENT_TYPE,
        version: WORKFLOW_CREATED_EVENT_VERSION,
        aggregateType: "workflow",
        aggregateId: "workflow-1",
        idempotencyKey: "project-1:workflow-1:created",
        data: created,
      });
    });
  });

  describe("when the worker's subscriber handles workflow_created", () => {
    /** @scenario "Workflow creation updates workflow count and fires event" */
    it("tells nurturing the workflow and its count with the event it came from", async () => {
      const recorded: NurturingSignal[] = [];
      const subscriber = buildWorkflowLifecyclePipeline({
        recordSignal: async (signal) => {
          recorded.push(signal);
        },
      }).eventSubscribers.get("workflowCreatedNurturing");
      if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");
      const event = createdEvent();

      await subscriber.handle(event, { tenantId: "project-1", aggregateId: "workflow-1" });

      expect(recorded).toEqual([
        {
          kind: "workflow_created",
          sourceEventId: event.id,
          tenantId: "project-1",
          occurredAt: 1_700_000_000_000,
          ...created,
        },
      ]);
    });

    it("lets a nurturing failure reach the queue, which retries it", async () => {
      const subscriber = buildWorkflowLifecyclePipeline({
        recordSignal: async () => {
          throw new Error("nurturing unavailable");
        },
      }).eventSubscribers.get("workflowCreatedNurturing");
      if (!subscriber) throw new Error("the pipeline declares no nurturing subscriber");

      await expect(
        subscriber.handle(createdEvent(), { tenantId: "project-1", aggregateId: "workflow-1" }),
      ).rejects.toThrow("nurturing unavailable");
    });
  });
});
