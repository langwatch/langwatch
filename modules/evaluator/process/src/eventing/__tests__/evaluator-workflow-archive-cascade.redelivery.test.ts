/**
 * @vitest-environment node
 * @unit
 * @see modules/evaluator/specs/evaluator-deleted-fact.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  WORKFLOW_ARCHIVED_EVENT_TYPE,
  type WorkflowArchivedEventData,
} from "@langwatch/workflow-contract";
import { describe, expect, it } from "vitest";

import { createEvaluatorTestApp } from "../../app/__tests__/evaluator.fixture.ts";
import type { EvaluatorWorkflowArchiveCascadePipeline } from "../evaluator-workflow-archive-cascade.pipeline.ts";

const LANE = "evaluator_workflow_archive_cascade.evaluatorWorkflowArchived";
const ARCHIVED: WorkflowArchivedEventData = {
  workflowId: "workflow-1",
  projectId: "project-1",
  occurredAt: 2_000,
};

function laneOf(pipeline: EvaluatorWorkflowArchiveCascadePipeline): EventSubscriberDefinition {
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const lane = lanes.get(LANE);
  if (!lane) throw new Error(`no ${LANE} lane mounted`);
  return lane;
}

function archivedEvent(id: string): Event {
  return {
    id,
    aggregateId: ARCHIVED.workflowId,
    aggregateType: "workflow",
    tenantId: createTenantId(ARCHIVED.projectId),
    createdAt: ARCHIVED.occurredAt,
    occurredAt: ARCHIVED.occurredAt,
    type: WORKFLOW_ARCHIVED_EVENT_TYPE,
    version: "2026-10-08",
    data: ARCHIVED,
  };
}

function deduplicationIdOf(definition: EventSubscriberDefinition, event: Event): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the peer subscriber declares its own deduplication id");
  }
  return strategy.makeId(event);
}

async function setup() {
  const { app, repository } = createEvaluatorTestApp();
  const sent: unknown[] = [];
  app.connectLifecycle({ recordEvaluatorDeleted: { send: async (data) => void sent.push(data) } });
  await repository.create({
    id: "evaluator-1",
    projectId: "project-1",
    name: "Workflow judge",
    type: "workflow",
    config: {},
    workflowId: "workflow-1",
  });
  return { app, repository, sent, lane: laneOf(app.workflowArchiveCascadePipeline()) };
}

const context = { tenantId: ARCHIVED.projectId, aggregateId: ARCHIVED.workflowId };

describe("evaluator's workflow archive cascade lane", () => {
  describe("when workflow records that a workflow was archived", () => {
    /** @scenario "an archived workflow archives the evaluators it backed" */
    it("archives the live evaluator and records it deleted for monitor", async () => {
      const { lane, repository, sent } = await setup();

      await lane.handle(archivedEvent("event-1"), context);

      expect(lane.eventTypes).toEqual([WORKFLOW_ARCHIVED_EVENT_TYPE]);
      expect(sent).toEqual([expect.objectContaining({ evaluatorId: "evaluator-1" })]);
      expect(
        await repository.findByWorkflow({ workflowId: "workflow-1", projectId: "project-1" }),
      ).toBeUndefined();
    });
  });

  describe("when the same archived fact is redelivered", () => {
    /** @scenario "a redelivered workflow archived fact archives nothing more" */
    it("keys both deliveries alike and records the evaluator deleted once", async () => {
      const { lane, sent } = await setup();
      const event = archivedEvent("event-1");
      const redelivered = archivedEvent("event-2");

      await lane.handle(event, context);
      await lane.handle(redelivered, context);

      expect(sent).toHaveLength(1);
      expect(deduplicationIdOf(lane, event)).toBe(deduplicationIdOf(lane, redelivered));
    });
  });
});
