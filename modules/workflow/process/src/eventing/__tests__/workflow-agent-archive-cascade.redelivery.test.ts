/**
 * @vitest-environment node
 * @unit
 * @see modules/workflow/specs/workflow-service.feature
 */
import { AGENT_ARCHIVED_EVENT_TYPE, type AgentArchivedEventData } from "@langwatch/agent-contract";
import type { DatasetApi } from "@langwatch/dataset-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type {
  WorkflowDslMigration,
  WorkflowExecution,
  WorkflowId,
} from "../../app/workflow.app.ts";
import { MemoryWorkflowRepositories } from "../../repositories/memory/memory.workflow.repositories.ts";
import type { StudioEventPreparer } from "../../services/studio-event-preparer.service.ts";
import { WorkflowService } from "../../services/workflow.service.ts";
import { buildWorkflowAgentArchiveCascadePipeline } from "../workflow-agent-archive-cascade.pipeline.ts";

const LANE = "workflow_agent_archive_cascade.workflowAgentArchived";

const ARCHIVED: AgentArchivedEventData = {
  agentId: "agent-1",
  projectId: "project-1",
  cascadedWorkflowId: "workflow-1",
  occurredAt: 1_500,
};

function archivedEvent({
  id = "event-1",
  data = ARCHIVED,
}: { id?: string; data?: AgentArchivedEventData } = {}): Event {
  return {
    id,
    aggregateId: data.agentId,
    aggregateType: "agent",
    tenantId: createTenantId(data.projectId),
    createdAt: data.occurredAt,
    occurredAt: data.occurredAt,
    type: AGENT_ARCHIVED_EVENT_TYPE,
    version: "2026-10-08",
    data,
  };
}

const CONTEXT = { tenantId: ARCHIVED.projectId, aggregateId: ARCHIVED.agentId };

async function cascadeLane() {
  const repositories = MemoryWorkflowRepositories.create();
  for (const [projectId, id] of [
    ["project-1", "workflow-1"],
    ["project-1", "workflow-2"],
    ["project-2", "workflow-3"],
  ] as const) {
    await repositories.workflows.createWorkflow({
      id,
      projectId,
      name: id,
      icon: null,
      description: null,
    });
  }
  const workflows = WorkflowService.create({
    repository: repositories.workflows,
    datasets: createApiFixture<DatasetApi>(),
    execution: createApiFixture<WorkflowExecution>(),
    studioEvents: createApiFixture<StudioEventPreparer>(),
    dslMigration: createApiFixture<WorkflowDslMigration>(),
    ids: createApiFixture<WorkflowId>(),
  });
  const archiveLinked = vi.spyOn(repositories.workflows, "archiveLinked");
  const pipeline = buildWorkflowAgentArchiveCascadePipeline({ workflows });
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const definition = lanes.get(LANE);
  if (!definition) throw new Error("no agent archive cascade lane mounted");

  const live = async (): Promise<string[]> => {
    const rows = await Promise.all(
      [
        ["project-1", "workflow-1"],
        ["project-1", "workflow-2"],
        ["project-2", "workflow-3"],
      ].map(([projectId, id]) =>
        repositories.workflows.findById({ id: id!, projectId: projectId! }),
      ),
    );
    return rows.flatMap((row) => (row ? [row.id] : []));
  };

  return { definition, live, archiveLinked };
}

function deduplicationIdOf({
  definition,
  event,
}: {
  definition: EventSubscriberDefinition;
  event: Event;
}): string {
  const strategy = definition.options?.deduplication;
  if (strategy === undefined || strategy === "aggregate") {
    throw new Error("the peer subscriber declares its own deduplication id");
  }
  return strategy.makeId(event);
}

describe("workflow's agent archive cascade peer lane", () => {
  describe("when agent records an archive naming a live graph", () => {
    /** @scenario "Agent's archived fact archives the graph it cascades to" */
    it("archives that graph and leaves every other graph live", async () => {
      const { definition, live } = await cascadeLane();

      await definition.handle(archivedEvent(), CONTEXT);

      expect(definition.eventTypes).toEqual([AGENT_ARCHIVED_EVENT_TYPE]);
      expect(await live()).toEqual(["workflow-2", "workflow-3"]);
    });
  });

  describe("when the archive names no graph, or a graph that is not live", () => {
    /** @scenario "An agent archived fact naming no live graph archives nothing" */
    it("changes no graph and succeeds", async () => {
      const { definition, live, archiveLinked } = await cascadeLane();

      await definition.handle(
        archivedEvent({ data: { ...ARCHIVED, cascadedWorkflowId: null } }),
        CONTEXT,
      );
      await definition.handle(
        archivedEvent({ data: { ...ARCHIVED, cascadedWorkflowId: "workflow-missing" } }),
        CONTEXT,
      );
      await definition.handle(
        archivedEvent({ data: { ...ARCHIVED, cascadedWorkflowId: "workflow-3" } }),
        CONTEXT,
      );

      expect(archiveLinked).not.toHaveBeenCalled();
      expect(await live()).toEqual(["workflow-1", "workflow-2", "workflow-3"]);
    });
  });

  describe("when the same archived fact is redelivered", () => {
    /** @scenario "A redelivered agent archived fact is harmless" */
    it("keys both deliveries alike and archives the graph only once", async () => {
      const { definition, live, archiveLinked } = await cascadeLane();

      await definition.handle(archivedEvent(), CONTEXT);
      await definition.handle(archivedEvent({ id: "redelivered" }), CONTEXT);

      expect(archiveLinked).toHaveBeenCalledTimes(1);
      expect(await live()).toEqual(["workflow-2", "workflow-3"]);
      expect(deduplicationIdOf({ definition, event: archivedEvent() })).toBe(
        deduplicationIdOf({ definition, event: archivedEvent({ id: "redelivered" }) }),
      );
    });
  });
});
