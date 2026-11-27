// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * Jobs the previous release queued under a lane this host retired reach the projection that
 * succeeds it, through the real eventing runtime: never dead-lettered, never dropped.
 * Spec: enterprise/modules/nurturing/specs/project-usage.feature
 */
import {
  BILLING_LIFECYCLE_AGGREGATE_TYPE,
  BILLING_LIFECYCLE_EVENT_VERSION,
  BILLING_LIFECYCLE_PIPELINE_NAME,
  SUBSCRIPTION_CHANGED_EVENT_TYPE,
  subscriptionChangedEventDataSchema,
} from "@langwatch/enterprise-billing-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
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
  type ReplayEvent,
} from "@langwatch/eventing";
import { EventStoreMemory, testEventSchema } from "@langwatch/eventing/testing";
import { SPAN_RECEIVED_EVENT_TYPE, TRACE_FAILED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryNurturingEvaluationDayRepository } from "../../repositories/memory/memory.nurturing-evaluation-day.repository.ts";
import { MemoryNurturingOrganizationPlanRepository } from "../../repositories/memory/memory.nurturing-organization-plan.repository.ts";
import { MemoryNurturingTraceDayRepository } from "../../repositories/memory/memory.nurturing-trace-day.repository.ts";
import { MemoryNurturingRepositories } from "../../repositories/memory/memory.nurturing.repositories.ts";
import {
  buildNurturingProjectUsagePipeline,
  NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS,
  NURTURING_PROJECT_USAGE_PIPELINE_NAME,
  NURTURING_SUBSCRIPTION_CHANGED_LANE_ALIAS,
  NURTURING_TRACE_DAY_LANE_ALIASES,
  nurturingEvaluationDaysMap,
  nurturingOrganizationPlanFold,
  nurturingPlanSyncSubscriber,
  nurturingTraceDayFailuresFold,
  nurturingTraceDaySpansFold,
} from "../nurturing-project-usage.pipeline.ts";
import {
  spanReceived,
  TRACE_MILESTONES_OWNER,
  TRACE_PROCESSING_OWNER,
  traceFailed,
} from "./nurturing-trace-days.test-helpers.ts";

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

/** Billing's subscription fact for org-1, as its log and a queued job carry it. */
function subscriptionChanged(): Event {
  return {
    id: "billing-1",
    aggregateId: "org-1",
    aggregateType: BILLING_LIFECYCLE_AGGREGATE_TYPE,
    tenantId: createTenantId("org-1"),
    createdAt: NOON,
    occurredAt: NOON,
    type: SUBSCRIPTION_CHANGED_EVENT_TYPE,
    version: BILLING_LIFECYCLE_EVENT_VERSION,
    idempotencyKey: "billing-1",
    data: {
      tenantId: "org-1",
      occurredAt: NOON,
      organizationId: "org-1",
      memberUserIds: ["user-1"],
      hasSubscription: true,
      plan: "GROWTH",
    },
  };
}

/** A worker of this release with evaluation's and billing's pipelines as stand-ins. */
function worker() {
  const eventStore = EventStoreMemory.createForTesting();
  const eventSourcing = new EventSourcing({ eventStore });
  eventSourcing.register(
    definePipeline({
      name: BILLING_LIFECYCLE_PIPELINE_NAME,
      aggregate: defineAggregate({ type: BILLING_LIFECYCLE_AGGREGATE_TYPE }),
    })
      .withEvents([
        testEventSchema(SUBSCRIPTION_CHANGED_EVENT_TYPE, subscriptionChangedEventDataSchema),
      ])
      .build(),
  );
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

/** A worker of this release with trace's two pipelines as stand-ins and both trace-day folds. */
function traceDayWorker() {
  const traceDays = MemoryNurturingTraceDayRepository.create();
  const eventStore = EventStoreMemory.createForTesting();
  const eventSourcing = new EventSourcing({ eventStore });
  for (const [{ name, aggregateType }, type] of [
    [TRACE_PROCESSING_OWNER, SPAN_RECEIVED_EVENT_TYPE],
    [TRACE_MILESTONES_OWNER, TRACE_FAILED_EVENT_TYPE],
  ] as const) {
    eventSourcing.register(
      definePipeline({ name, aggregate: defineAggregate({ type: aggregateType }) })
        .withEvents([testEventSchema(type, z.unknown())])
        .build(),
    );
  }
  eventSourcing.register(
    usageHost()
      .withPeerFoldProjection(nurturingTraceDaySpansFold(traceDays.forSource("spans")))
      .withPeerFoldProjection(nurturingTraceDayFailuresFold(traceDays.forSource("failures")))
      .withLaneAliases(NURTURING_TRACE_DAY_LANE_ALIASES)
      .build(),
  );
  eventSourcing.startConsumers();
  return { traceDays, eventStore, eventSourcing };
}

/** A logged trace fact as its owner appended it. */
const appended = ({ timestamp: _timestamp, ...fact }: ReplayEvent): Event => ({
  ...fact,
  tenantId: createTenantId(fact.tenantId),
});

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
      traceDays: repositories.traceDays,
      copies: {
        placements: repositories.placements,
        organizationsCreated: repositories.organizationsCreated,
        admins: repositories.milestones,
        members: repositories.members,
        virtualKeys: repositories.virtualKeys,
        personalProjects: repositories.personalProjects,
        tracedProjects: repositories.tracedProjects,
        lastTraces: repositories.milestones,
      },
      plans: { store: repositories.plans, deliver: async () => undefined },
      sync: undefined,
    });

    expect(pipeline.laneAliases).toContainEqual(NURTURING_EVALUATION_ACTIVE_DAY_LANE_ALIAS);
    expect(pipeline.laneAliases).toContainEqual(NURTURING_SUBSCRIPTION_CHANGED_LANE_ALIAS);
    for (const alias of NURTURING_TRACE_DAY_LANE_ALIASES) {
      expect(pipeline.laneAliases).toContainEqual(alias);
    }
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

  describe("given a job the previous release queued under the subscriptionChanged lane", () => {
    /** @scenario "A subscription_changed job the previous release queued still sends its plan" */
    it("folds it into the plan copy and sends it once, as the fact that won", async () => {
      const plans = MemoryNurturingOrganizationPlanRepository.create();
      const delivered: NurturingSignal[] = [];
      const { eventStore, eventSourcing } = worker();
      eventSourcing.register(
        usageHost()
          .withPeerFoldProjection(nurturingOrganizationPlanFold(plans), [
            nurturingPlanSyncSubscriber({
              store: plans,
              deliver: async ({ signal }) => void delivered.push(signal),
            }),
          ])
          .withLaneAliases([NURTURING_SUBSCRIPTION_CHANGED_LANE_ALIAS])
          .build(),
      );
      eventSourcing.startConsumers();
      const fact = subscriptionChanged();
      await eventStore.seed({ events: [fact] });

      await queuedByPreviousRelease({
        eventSourcing,
        key: NURTURING_SUBSCRIPTION_CHANGED_LANE_ALIAS.from,
        event: fact,
      });

      await vi.waitFor(() =>
        expect(delivered).toEqual([
          expect.objectContaining({
            kind: "subscription_changed",
            organizationId: "org-1",
            plan: "GROWTH",
          }),
        ]),
      );
      await expect(plans.get("org-1")).resolves.toMatchObject({
        kind: "folded",
        state: { winnerEventId: fact.id },
      });
      await eventSourcing.close();
    });

    /** @scenario "A subscription_changed job the previous release queued still sends its plan" */
    it("routes the former key to the plan fold, never to a tombstone", () => {
      expect(NURTURING_SUBSCRIPTION_CHANGED_LANE_ALIAS).toEqual({
        from: "global:subscriber:nurturing.subscriptionChanged",
        to: { jobType: "projection", lane: "organizationPlans" },
      });
    });
  });

  describe("given a job the previous release queued under the traceDayCount subscriber's lane", () => {
    /** @scenario "A job queued under a retired copy lane reaches its successor" */
    it("counts its trace through the spans fold", async () => {
      const { traceDays, eventStore, eventSourcing } = traceDayWorker();
      const fact = appended(spanReceived({ id: "span-1", createdAt: NOON }));
      await eventStore.seed({ events: [fact] });

      await queuedByPreviousRelease({
        eventSourcing,
        key: NURTURING_TRACE_DAY_LANE_ALIASES[0]!.from,
        event: fact,
      });

      await vi.waitFor(async () =>
        expect(
          await traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" }),
        ).toEqual([expect.objectContaining({ day: "2026-11-20", traceCount: 1, errorCount: 0 })]),
      );
      await eventSourcing.close();
    });
  });

  describe("given a job the previous release queued under the failedTraceDayCount subscriber's lane", () => {
    /** @scenario "A job queued under a retired copy lane reaches its successor" */
    it("counts its failure through the failures fold", async () => {
      const { traceDays, eventStore, eventSourcing } = traceDayWorker();
      const fact = appended(traceFailed({ id: "trace-1", createdAt: NOON }));
      await eventStore.seed({ events: [fact] });

      await queuedByPreviousRelease({
        eventSourcing,
        key: NURTURING_TRACE_DAY_LANE_ALIASES[1]!.from,
        event: fact,
      });

      await vi.waitFor(async () =>
        expect(
          await traceDays.findForProjects({ projectIds: ["project-1"], afterDay: "" }),
        ).toEqual([expect.objectContaining({ day: "2026-11-20", traceCount: 0, errorCount: 1 })]),
      );
      await eventSourcing.close();
    });
  });
});
