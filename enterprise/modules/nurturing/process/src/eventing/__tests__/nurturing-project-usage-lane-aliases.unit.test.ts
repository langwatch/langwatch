// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Jobs the previous release queued under a lane this host retired reach the projection that
 * succeeds it, through the real eventing runtime: never dead-lettered, never dropped.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
  EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
  EVALUATION_LIFECYCLE_EVENT_VERSION,
  EVALUATION_LIFECYCLE_PIPELINE_NAME,
  evaluationLifecycleCompletedEventDataSchema,
} from "@langwatch/evaluation-contract";
import {
  createTenantId,
  defineAggregate,
  definePipeline,
  type Event,
  EventSourcing,
} from "@langwatch/eventing";
import { EventStoreMemory, testEventSchema } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { MemoryNurturingEvaluationDayRepository } from "../../repositories/memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  nurturingEvaluationDaysMap,
} from "../nurturing-project-usage.pipeline.ts";

const NOON = Date.UTC(2026, 10, 20, 12);

/** Evaluation's settled fact, as its log and a queued job carry it. */
function evaluated(projectId: string): Event {
  return {
    id: `evaluation-${projectId}`,
    aggregateId: `evaluation-${projectId}`,
    aggregateType: EVALUATION_LIFECYCLE_AGGREGATE_TYPE,
    tenantId: createTenantId(projectId),
    createdAt: NOON,
    occurredAt: NOON,
    type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    version: EVALUATION_LIFECYCLE_EVENT_VERSION,
    data: {
      tenantId: projectId,
      projectId,
      evaluationId: `evaluation-${projectId}`,
      occurredAt: NOON,
    },
  };
}

/** A worker of this release with evaluation's pipeline as a stand-in; the test registers the host. */
function worker() {
  const eventStore = EventStoreMemory.createForTesting();
  const eventSourcing = new EventSourcing({ eventStore });
  eventSourcing.register(
    definePipeline({
      name: EVALUATION_LIFECYCLE_PIPELINE_NAME,
      aggregate: defineAggregate({ type: EVALUATION_LIFECYCLE_AGGREGATE_TYPE }),
    })
      .withEvents([
        testEventSchema(
          EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
          evaluationLifecycleCompletedEventDataSchema,
        ),
      ])
      .build(),
  );
  return { eventStore, eventSourcing };
}

/** A job the previous release queued under `key`, `<pipeline>:<jobType>:<name>`, for `event`. */
async function queuedByPreviousRelease({
  eventSourcing,
  key,
  event,
}: {
  eventSourcing: EventSourcing;
  key: string;
  event: Event;
}): Promise<void> {
  const [pipeline, jobType, ...name] = key.split(":");
  await eventSourcing.globalQueue?.send({
    ...event,
    __pipelineName: pipeline,
    __jobType: jobType,
    __jobName: name.join(":"),
  });
}

const usageHost = () =>
  definePipeline({
    name: NURTURING_PROJECT_USAGE_PIPELINE_NAME,
    aggregate: defineAggregate({ type: "nurturing_project_usage_view" }),
  }).withEvents([]);

describe("the usage host's lane aliases", () => {
  /** @scenario "A job queued under a retired copy lane reaches its successor" */
  it("declares each retired lane's alias on the host the module installs", () => {
    const repositories = MemoryNurturingRepositories.create();
    const pipeline = buildNurturingProjectUsagePipeline({
      store: repositories.projectUsage,
      evaluationDays: repositories.evaluationDays,
      copies: {
        placements: repositories.placements,
        copyLanded: async () => undefined,
        organizationsCreated: repositories.organizationsCreated,
        admins: repositories.milestones,
        members: repositories.members,
        virtualKeys: repositories.virtualKeys,
        personalProjects: repositories.personalProjects,
        tracedProjects: repositories.tracedProjects,
        lastTraces: repositories.milestones,
      },
      sync: undefined,
    });

    expect(pipeline.laneAliases).toContainEqual(NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS);
    expect(pipeline.laneAliases?.some((alias) => "tombstone" in alias)).toBe(false);
  });

  describe("given a job the previous release queued under the evaluation-day subscriber's lane", () => {
    /** @scenario "A job queued under a retired copy lane reaches its successor" */
    it("writes its day through the evaluation-day map", async () => {
      const days = MemoryNurturingEvaluationDayRepository.create();
      const { eventStore, eventSourcing } = worker();
      eventSourcing.register(
        usageHost()
          .withPeerMapProjection(nurturingEvaluationDaysMap(days))
          .withLaneAliases([NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS])
          .build(),
      );
      eventSourcing.startConsumers();
      const fact = evaluated("project-1");
      await eventStore.seed({ events: [fact] });

      await queuedByPreviousRelease({
        eventSourcing,
        key: NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS.from,
        event: fact,
      });

      await vi.waitFor(async () =>
        expect(await days.findForProjects({ projectIds: ["project-1"], afterDay: "" })).toEqual([
          { projectId: "project-1", day: "2026-11-20" },
        ]),
      );
      await eventSourcing.close();
    });
  });
});
