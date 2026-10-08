/**
 * A created workflow is recorded on workflow's own pipeline, and nurturing
 * reacts to its event from its own side.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  WORKFLOW_ARCHIVED_EVENT_TYPE,
  WORKFLOW_CREATED_EVENT_TYPE,
  WORKFLOW_VERSION_SAVED_EVENT_TYPE,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import {
  RecordWorkflowArchivedCommand,
  RecordWorkflowCreatedCommand,
  RecordWorkflowVersionSavedCommand,
  WORKFLOW_ARCHIVED_EVENT_VERSION,
  WORKFLOW_CREATED_EVENT_VERSION,
  WORKFLOW_VERSION_SAVED_EVENT_VERSION,
  type WorkflowCreatedEvent,
} from "../workflow-lifecycle.commands.ts";

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

  describe("when the record-version-saved command is handled", () => {
    const saved = {
      workflowId: "workflow-1",
      projectId: "project-1",
      versionId: "version-7",
      authorId: "user-1",
    };

    /** @scenario Saving a Studio graph records the version as a fact agents react to */
    it("appends one version_saved event keyed by the workflow, the version and the instant", () => {
      const [event] = new RecordWorkflowVersionSavedCommand().handle({
        tenantId: createTenantId("project-1"),
        type: "lw.workflow.record_version_saved",
        aggregateId: saved.workflowId,
        data: { tenantId: "project-1", occurredAt: 1_700_000_000_000, ...saved },
      });

      expect(event).toMatchObject({
        type: WORKFLOW_VERSION_SAVED_EVENT_TYPE,
        version: WORKFLOW_VERSION_SAVED_EVENT_VERSION,
        aggregateType: "workflow",
        aggregateId: "workflow-1",
        idempotencyKey: "project-1:workflow-1:version_saved:version-7:1700000000000",
        data: saved,
      });
    });
  });

  describe("when the record-archived command is handled", () => {
    /** @scenario "Archiving a workflow records the archived fact agents react to" */
    it("appends one archived event keyed by the workflow and the instant", () => {
      const [event] = new RecordWorkflowArchivedCommand().handle({
        tenantId: createTenantId("project-1"),
        type: "lw.workflow.record_archived",
        aggregateId: "workflow-1",
        data: {
          tenantId: "project-1",
          occurredAt: 1_700_000_000_000,
          workflowId: "workflow-1",
          projectId: "project-1",
        },
      });

      expect(event).toMatchObject({
        type: WORKFLOW_ARCHIVED_EVENT_TYPE,
        version: WORKFLOW_ARCHIVED_EVENT_VERSION,
        aggregateType: "workflow",
        aggregateId: "workflow-1",
        idempotencyKey: "project-1:workflow-1:archived:1700000000000",
      });
    });
  });
});
