import {
  EVALUATOR_DELETED_EVENT_TYPE,
  type EvaluatorDeletedEventData,
} from "@langwatch/evaluator-contract";
/**
 * @vitest-environment node
 * @unit
 * @see modules/monitor/specs/monitor-evaluator-cleanup.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import type { MonitorWithEvaluator } from "@langwatch/monitor-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import {
  createMonitorTestApp,
  createMonitorTestRepositories,
} from "../../app/__tests__/monitor.fixture.ts";
import { MemoryMonitorRepository } from "../../repositories/memory/memory.monitor.repository.ts";

const LANE = "monitor_evaluator_cleanup.monitorEvaluatorDeleted";
const NOW = new Date("2026-10-07T00:00:00.000Z");

const DELETED: EvaluatorDeletedEventData = {
  tenantId: "project-1",
  projectId: "project-1",
  evaluatorId: "evaluator-1",
  occurredAt: 1_500,
};

function monitorRow({
  id,
  evaluatorId,
}: {
  id: string;
  evaluatorId: string;
}): MonitorWithEvaluator {
  return {
    id,
    projectId: "project-1",
    experimentId: null,
    evaluatorId,
    checkType: "langevals/llm_boolean",
    name: `Monitor ${id}`,
    slug: `monitor-${id}`,
    executionMode: "ON_MESSAGE",
    enabled: true,
    preconditions: [],
    parameters: {},
    mappings: { mapping: {}, expansions: [] },
    sample: 1,
    level: "trace",
    threadIdleTimeout: null,
    createdAt: NOW,
    updatedAt: NOW,
    evaluator: null,
  };
}

function deletedEvent({ id = "event-1" }: { id?: string } = {}): Event {
  return {
    id,
    aggregateId: DELETED.evaluatorId,
    aggregateType: "evaluator",
    tenantId: createTenantId(DELETED.tenantId),
    createdAt: DELETED.occurredAt,
    occurredAt: DELETED.occurredAt,
    type: EVALUATOR_DELETED_EVENT_TYPE,
    version: "2026-10-07",
    data: DELETED,
  };
}

function cleanupLane(): {
  definition: EventSubscriberDefinition;
  repository: MemoryMonitorRepository;
} {
  const repository = MemoryMonitorRepository.create({
    seed: [
      monitorRow({ id: "monitor-1", evaluatorId: "evaluator-1" }),
      monitorRow({ id: "monitor-2", evaluatorId: "evaluator-1" }),
      monitorRow({ id: "monitor-3", evaluatorId: "evaluator-2" }),
    ],
  });
  const pipeline = createMonitorTestApp({
    repositories: createMonitorTestRepositories(repository),
  }).evaluatorCleanupPipeline();
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const definition = lanes.get(LANE);
  if (!definition) throw new Error("no evaluator cleanup lane mounted");
  return { definition, repository };
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

async function remainingIds(repository: MemoryMonitorRepository): Promise<string[]> {
  const rows = await repository.findAll({ projectId: "project-1" });
  return rows.map(({ id }) => id);
}

const CONTEXT = { tenantId: DELETED.tenantId, aggregateId: DELETED.evaluatorId };

describe("monitor's evaluator cleanup peer lane", () => {
  describe("when evaluator records an evaluator deleted", () => {
    /** @scenario "a deleted evaluator's monitors are removed" */
    it("removes the monitors that ran it and keeps the others", async () => {
      const { definition, repository } = cleanupLane();

      await definition.handle(deletedEvent(), CONTEXT);

      expect(definition.eventTypes).toEqual([EVALUATOR_DELETED_EVENT_TYPE]);
      expect(await remainingIds(repository)).toEqual(["monitor-3"]);
    });
  });

  describe("when the same deleted fact is redelivered", () => {
    /** @scenario "a redelivered evaluator deleted fact is harmless" */
    it("keys both deliveries alike and removes nothing the second time", async () => {
      const { definition, repository } = cleanupLane();

      await definition.handle(deletedEvent(), CONTEXT);
      await definition.handle(deletedEvent({ id: "redelivered" }), CONTEXT);

      expect(await remainingIds(repository)).toEqual(["monitor-3"]);
      expect(deduplicationIdOf({ definition, event: deletedEvent() })).toBe(
        deduplicationIdOf({ definition, event: deletedEvent({ id: "redelivered" }) }),
      );
    });
  });
});
