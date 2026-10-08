/**
 * @vitest-environment node
 * @unit
 * @see modules/topic/specs/event-sourced-scheduling.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  FIRST_TRACE_RECORDED_EVENT_TYPE,
  type FirstTraceRecordedEventData,
  TRACE_RECEIVED_EVENT_TYPE,
  type TraceReceivedEventData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryTopicRepositories } from "../../repositories/memory/memory.topic.repositories.ts";
import { TopicClusteringBootstrapService } from "../../services/topic-clustering-bootstrap.service.ts";
import type { EventingTopicClusteringCommandsService } from "../../services/topic-clustering-commands.service.ts";
import { createTopicClusteringProcessingPipeline } from "../topic-clustering-processing.pipeline.ts";
import type { TopicClusteringSeeds } from "../topic-clustering-seed.intent.ts";
import type { TopicClusteringDispatchDeps } from "../topic-clustering.intent.ts";

const FIRST_TRACE_LANE = "topic_clustering_processing.topicClusteringFirstTraceBootstrap";
const TRACE_RECEIVED_LANE = "topic_clustering_processing.topicClusteringTraceReceivedBootstrap";

type ClusteringRequest = Parameters<EventingTopicClusteringCommandsService["requestClustering"]>[0];

const FIRST_TRACE: FirstTraceRecordedEventData = {
  tenantId: "project-1",
  projectId: "project-1",
  userId: "user-1",
  sdkLanguage: "python",
  sdkFramework: "openai",
  occurredAt: 1_000,
};

const TRACE_RECEIVED: TraceReceivedEventData = {
  tenantId: "project-1",
  projectId: "project-1",
  userId: "user-1",
  occurredAt: 2_000,
};

function milestoneEvent({
  id,
  type,
  data,
}: {
  id: string;
  type: string;
  data: FirstTraceRecordedEventData | TraceReceivedEventData;
}): Event {
  return {
    id,
    aggregateId: data.projectId,
    aggregateType: "trace_project_milestone",
    tenantId: createTenantId(data.tenantId),
    createdAt: data.occurredAt,
    occurredAt: data.occurredAt,
    type,
    version: "2026-10-01",
    data,
  };
}

function bootstrapLanes(): {
  lanes: Map<string, EventSubscriberDefinition>;
  requests: ClusteringRequest[];
} {
  const repositories = MemoryTopicRepositories.create();
  const requests: ClusteringRequest[] = [];
  const pipeline = createTopicClusteringProcessingPipeline({
    topicClusteringRunStatusStore: repositories.runStatus,
    topicClusteringRunHistoryStore: repositories.runHistory,
    topicModelStore: repositories.topicModel,
    dispatch: createApiFixture<TopicClusteringDispatchDeps>({}),
    seeds: createApiFixture<TopicClusteringSeeds>({}),
    bootstrap: TopicClusteringBootstrapService.create({
      claims: repositories.claims,
      commands: createApiFixture<Pick<EventingTopicClusteringCommandsService, "requestClustering">>(
        { requestClustering: async (request) => void requests.push(request) },
      ),
    }),
  });
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  return { lanes, requests };
}

function laneOf({
  lanes,
  name,
}: {
  lanes: Map<string, EventSubscriberDefinition>;
  name: string;
}): EventSubscriberDefinition {
  const definition = lanes.get(name);
  if (!definition) throw new Error(`no ${name} lane mounted`);
  return definition;
}

const CONTEXT = { tenantId: "project-1", aggregateId: "project-1" };

describe("topic's clustering bootstrap peer lanes", () => {
  describe("when trace records a project's first trace", () => {
    /** @scenario "trace's first-trace milestone bootstraps the project's clustering schedule from topic's side" */
    it("requests the project's clustering bootstrap", async () => {
      const { lanes, requests } = bootstrapLanes();
      const definition = laneOf({ lanes, name: FIRST_TRACE_LANE });

      await definition.handle(
        milestoneEvent({ id: "event-1", type: FIRST_TRACE_RECORDED_EVENT_TYPE, data: FIRST_TRACE }),
        CONTEXT,
      );

      expect(definition.eventTypes).toEqual([FIRST_TRACE_RECORDED_EVENT_TYPE]);
      expect(requests).toEqual([
        { tenantId: "project-1", occurredAt: expect.any(Number), trigger: "bootstrap" },
      ]);
    });
  });

  describe("when trace records a later trace on a project", () => {
    /** @scenario "trace's later-trace milestone re-asserts the project's clustering schedule" */
    it("requests the project's clustering bootstrap", async () => {
      const { lanes, requests } = bootstrapLanes();
      const definition = laneOf({ lanes, name: TRACE_RECEIVED_LANE });

      await definition.handle(
        milestoneEvent({ id: "event-2", type: TRACE_RECEIVED_EVENT_TYPE, data: TRACE_RECEIVED }),
        CONTEXT,
      );

      expect(definition.eventTypes).toEqual([TRACE_RECEIVED_EVENT_TYPE]);
      expect(requests).toEqual([
        { tenantId: "project-1", occurredAt: expect.any(Number), trigger: "bootstrap" },
      ]);
    });
  });

  describe("when the same milestone is redelivered, or both milestones arrive in one window", () => {
    /** @scenario "a redelivered trace milestone requests the clustering bootstrap once" */
    it("requests the bootstrap once and does not fail", async () => {
      const { lanes, requests } = bootstrapLanes();
      const firstTrace = laneOf({ lanes, name: FIRST_TRACE_LANE });
      const traceReceived = laneOf({ lanes, name: TRACE_RECEIVED_LANE });
      const event = milestoneEvent({
        id: "event-1",
        type: FIRST_TRACE_RECORDED_EVENT_TYPE,
        data: FIRST_TRACE,
      });

      await firstTrace.handle(event, CONTEXT);
      await firstTrace.handle({ ...event, id: "redelivered" }, CONTEXT);
      await traceReceived.handle(
        milestoneEvent({ id: "event-2", type: TRACE_RECEIVED_EVENT_TYPE, data: TRACE_RECEIVED }),
        CONTEXT,
      );

      expect(requests).toHaveLength(1);
    });
  });
});
