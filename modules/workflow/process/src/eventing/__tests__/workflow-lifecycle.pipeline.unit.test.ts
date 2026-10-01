/**
 * A created workflow is recorded on workflow's own pipeline, and nurturing
 * reacts to its event from its own side.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { WORKFLOW_CREATED_EVENT_TYPE } from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { RecordWorkflowCreatedCommand } from "../workflow-lifecycle.commands.ts";
import {
  WORKFLOW_CREATED_EVENT_VERSION,
  type WorkflowCreatedEvent,
} from "../workflow-lifecycle.events.ts";

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
});
