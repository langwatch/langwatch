// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/nurturing.feature
 */
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE } from "@langwatch/evaluation-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TRACE_RECEIVED_EVENT_TYPE } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { NURTURING_BATCH_MAX } from "../nurturing-batch.subscriber.ts";
import { buildNurturingPipeline } from "../nurturing.pipeline.ts";

const MORNING = 1_791_280_800_000;
const NEXT_DAY = 1_791_334_800_000;

/** Nurturing's pipeline with every delivered signal recorded, its peer lanes by event type. */
function nurturingRecordingDeliveries() {
  const delivered: NurturingSignal[] = [];
  const counted: unknown[][] = [];
  const pipeline = buildNurturingPipeline({
    deliver: async ({ signal }) => void delivered.push(signal),
    projectCreated: async () => undefined,
    guidedTurnFailed: async () => undefined,
    usageReportReceived: async () => undefined,
    evaluationsCompleted: async ({ evaluations }) => void counted.push([...evaluations]),
    simulationRunsFinished: async () => undefined,
    codingSessionsStored: async () => undefined,
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({ registerEventSubscriber: (subscriber) => void subscribers.push(subscriber) });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const laneOf = (type: string) =>
    subscribers.filter(({ eventTypes }) => eventTypes.includes(type));
  /** Hands the events to the type's batched lane as one coalesced batch, as the queue would. */
  const deliverBatch = async (type: string, events: Event[]) => {
    for (const lane of laneOf(type).filter(({ handleBatch }) => handleBatch)) {
      await lane.handleBatch?.(
        events,
        events.map((event) => ({ tenantId: event.tenantId, aggregateId: event.aggregateId })),
      );
    }
  };
  return { delivered, counted, laneOf, deliverBatch };
}

function traceReceived(occurredAt: number): Event {
  return {
    id: `evt-trace-${occurredAt}`,
    aggregateId: `project-1:${occurredAt}`,
    aggregateType: "trace_project",
    tenantId: createTenantId("project-1"),
    createdAt: occurredAt,
    occurredAt,
    type: TRACE_RECEIVED_EVENT_TYPE,
    version: "2026-10-01",
    data: {
      tenantId: "project-1",
      projectId: "project-1",
      userId: "admin-1",
      occurredAt,
      organizationCreatedAt: occurredAt,
      onboardingVariant: "guided",
    },
    idempotencyKey: `project-1:trace_received:${occurredAt}`,
  } as Event;
}

function evaluationSettled(evaluationId: string): Event {
  return {
    id: `evt-${evaluationId}`,
    aggregateId: evaluationId,
    aggregateType: "evaluation_lifecycle",
    tenantId: createTenantId("project-1"),
    createdAt: MORNING,
    occurredAt: MORNING,
    type: EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE,
    version: "2026-10-01",
    data: { tenantId: "project-1", occurredAt: MORNING, projectId: "project-1", evaluationId },
    idempotencyKey: `project-1:${evaluationId}:lifecycle_completed`,
  } as Event;
}

describe("nurturing's batched lanes", () => {
  describe("when nurturing's pipeline is built", () => {
    it("queues the busy lanes per project and drains a backed-up project's facts together", () => {
      const { laneOf } = nurturingRecordingDeliveries();
      const busy = [
        ...laneOf(EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE),
        ...laneOf(TRACE_RECEIVED_EVENT_TYPE),
        ...laneOf(SIMULATION_RUN_EVENT_TYPES.FINISHED).filter(({ handleBatch }) => handleBatch),
      ];

      expect(busy).toHaveLength(3);
      for (const lane of busy) {
        expect(lane.options?.coalesceMaxBatch).toBe(NURTURING_BATCH_MAX);
        expect(lane.handleBatch).toBeTypeOf("function");
        expect(lane.options?.groupKeyFn?.(evaluationSettled("eval-1"))).toBe(
          lane.options?.groupKeyFn?.(evaluationSettled("eval-2")),
        );
      }
    });
  });

  describe("when a backed-up project's settled evaluations arrive as one batch", () => {
    /** @scenario "A backed-up project's settled evaluations are counted in one step and send one update" */
    it("hands them to the count in one call", async () => {
      const { counted, deliverBatch } = nurturingRecordingDeliveries();

      await deliverBatch(EVALUATION_LIFECYCLE_COMPLETED_EVENT_TYPE, [
        evaluationSettled("eval-1"),
        evaluationSettled("eval-2"),
        evaluationSettled("eval-3"),
      ]);

      expect(counted).toHaveLength(1);
      expect(counted[0]).toMatchObject([
        { evaluationId: "eval-1" },
        { evaluationId: "eval-2" },
        { evaluationId: "eval-3" },
      ]);
    });
  });

  describe("when a backed-up project's traces arrive as one batch", () => {
    /** @scenario "A backed-up project's traces tell Customer.io once" */
    it("sends trace_received once for the latest trace and one active day per day", async () => {
      const { delivered, deliverBatch } = nurturingRecordingDeliveries();

      await deliverBatch(TRACE_RECEIVED_EVENT_TYPE, [
        traceReceived(MORNING),
        traceReceived(NEXT_DAY),
        traceReceived(MORNING + 1_000),
      ]);

      expect(delivered.filter(({ kind }) => kind === "trace_received")).toMatchObject([
        { occurredAt: NEXT_DAY, sourceEventId: `project-1:${NEXT_DAY}` },
      ]);
      expect(delivered.filter(({ kind }) => kind === "project_active_day")).toHaveLength(2);
    });
  });
});
