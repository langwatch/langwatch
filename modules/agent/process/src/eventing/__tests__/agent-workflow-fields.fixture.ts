/** Mounts agent's workflow-fields peer lanes and builds the workflow facts they hear. */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  WORKFLOW_ARCHIVED_EVENT_TYPE,
  WORKFLOW_VERSION_SAVED_EVENT_TYPE,
  type WorkflowArchivedEventData,
  type WorkflowVersionSavedEventData,
} from "@langwatch/workflow-contract";

import type { AgentWorkflowFieldsPipeline } from "../agent-workflow-fields.pipeline.ts";

export const VERSION_SAVED_LANE = "agent_workflow_fields.workflowVersionSaved";
export const ARCHIVED_LANE = "agent_workflow_fields.workflowArchived";

export function lanesOf(pipeline: AgentWorkflowFieldsPipeline) {
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const lane = (name: string): EventSubscriberDefinition => {
    const definition = lanes.get(name);
    if (!definition) throw new Error(`no ${name} lane mounted`);
    return definition;
  };
  return { versionSaved: lane(VERSION_SAVED_LANE), archived: lane(ARCHIVED_LANE) };
}

function workflowEvent({
  id,
  type,
  version,
  data,
}: {
  id: string;
  type: string;
  version: string;
  data: WorkflowVersionSavedEventData | WorkflowArchivedEventData;
}): Event {
  return {
    id,
    aggregateId: data.workflowId,
    aggregateType: "workflow",
    tenantId: createTenantId(data.projectId),
    createdAt: data.occurredAt,
    occurredAt: data.occurredAt,
    type,
    version,
    data,
  };
}

export function versionSavedEvent({
  id = "event-saved",
  ...data
}: Partial<WorkflowVersionSavedEventData> & { id?: string }): Event {
  return workflowEvent({
    id,
    type: WORKFLOW_VERSION_SAVED_EVENT_TYPE,
    version: "2026-10-07",
    data: {
      workflowId: "workflow_1",
      projectId: "project_1",
      versionId: "version_1",
      authorId: "user_1",
      occurredAt: 1_000,
      ...data,
    },
  });
}

export function archivedEvent({
  id = "event-archived",
  ...data
}: Partial<WorkflowArchivedEventData> & { id?: string }): Event {
  return workflowEvent({
    id,
    type: WORKFLOW_ARCHIVED_EVENT_TYPE,
    version: "2026-10-08",
    data: { workflowId: "workflow_1", projectId: "project_1", occurredAt: 2_000, ...data },
  });
}

export function contextOf(event: Event) {
  return { tenantId: String(event.tenantId), aggregateId: String(event.aggregateId) };
}

export function deduplicationIdOf({
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
