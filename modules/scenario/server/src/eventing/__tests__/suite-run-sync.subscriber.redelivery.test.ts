/**
 * @vitest-environment node
 * @unit
 *
 * Redelivery contract for suiteRunSync: dispatches SAME command twice (byte-identical).
 * Known downstream gap: deduplication not wired, causes double-counting (outside scope).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { getSuiteSetId } from "@langwatch/suite-contract";

import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";
import { createSuiteRunSyncSubscriber } from "../suite-run-sync.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const SUITE_SET_ID = getSuiteSetId("suite-1");

interface Dispatch {
  kind: "itemStarted" | "itemCompleted";
  data: Record<string, unknown>;
}

/**
 * Stands in for the suite run pipeline. Records every command dispatched and
 * exposes the identity each one names, built from the payload's own fields in
 * the same shape the suite commands derive their idempotency key from.
 */
function makeSuitePipeline() {
  const dispatches: Dispatch[] = [];
  const record = (kind: Dispatch["kind"]) => async (data: Record<string, unknown>) => {
    dispatches.push({ kind, data });
  };
  return {
    dispatches,
    deps: {
      recordSuiteRunItemStarted: record("itemStarted"),
      completeSuiteRunItem: record("itemCompleted"),
    } as Parameters<typeof createSuiteRunSyncSubscriber>[0],
    items(): Set<string> {
      return new Set(
        dispatches.map(
          ({ kind, data }) =>
            `${String(data.tenantId)}:${String(data.batchRunId)}:${String(data.scenarioRunId)}:${kind}`,
        ),
      );
    },
  };
}

function makeEvent(overrides: {
  type: SimulationProcessingEvent["type"];
  occurredAt: number;
  data: Record<string, unknown>;
}): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: String(overrides.data.scenarioRunId),
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: overrides.occurredAt,
    version: "2026-08-06",
    ...overrides,
  } as SimulationProcessingEvent;
}

function startedEvent(scenarioRunId = "run-1"): SimulationProcessingEvent {
  return makeEvent({
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    occurredAt: 2_000,
    data: {
      scenarioRunId,
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: SUITE_SET_ID,
    },
  });
}

function finishedEvent(scenarioRunId = "run-1"): SimulationProcessingEvent {
  return makeEvent({
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    occurredAt: 5_000,
    data: {
      scenarioRunId,
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: SUITE_SET_ID,
      status: "SUCCESS",
      durationMs: 1_500,
      results: { verdict: "success", reasoning: "all criteria met" },
    },
  });
}

function contextFor(aggregateId = "run-1") {
  return { tenantId: "project-1", aggregateId, state: undefined };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("suiteRunSync subscriber redelivery", () => {
  describe("given a suite run's started event handled twice", () => {
    it("names one suite run item across both dispatches", async () => {
      const suite = makeSuitePipeline();
      const subscriber = createSuiteRunSyncSubscriber(suite.deps);
      const event = startedEvent();

      await subscriber.handler(event, contextFor());
      await subscriber.handler(event, contextFor());

      expect(suite.dispatches).toHaveLength(2);
      expect(suite.items().size).toBe(1);
    });
  });

  describe("given a suite run's finished event handled twice", () => {
    it("names one suite run item across both dispatches", async () => {
      const suite = makeSuitePipeline();
      const subscriber = createSuiteRunSyncSubscriber(suite.deps);
      const event = finishedEvent();

      await subscriber.handler(event, contextFor());
      await subscriber.handler(event, contextFor());

      expect(suite.dispatches).toHaveLength(2);
      expect(suite.items().size).toBe(1);
    });
  });

  describe("given two deliveries separated by wall-clock time", () => {
    /**
     * The load-bearing property, made falsifiable. `occurredAt` rides on the
     * event, so the second dispatch is byte-identical to the first however
     * much later it happens. Swapping it for a clock reading would leave the
     * key stable but the payload different, and the suite item would record a
     * time that belongs to the retry rather than to the run.
     */
    it("dispatches an identical payload, taking occurredAt from the event", async () => {
      vi.useFakeTimers();
      const suite = makeSuitePipeline();
      const subscriber = createSuiteRunSyncSubscriber(suite.deps);
      const event = finishedEvent();

      vi.setSystemTime(new Date("2026-01-15T09:00:00.000Z"));
      await subscriber.handler(event, contextFor());
      vi.setSystemTime(new Date("2026-02-15T09:00:00.000Z"));
      await subscriber.handler(event, contextFor());

      const [first, second] = suite.dispatches;
      expect(second).toEqual(first);
      expect(first?.data.occurredAt).toBe(event.occurredAt);
    });
  });

  describe("given two runs in the same batch", () => {
    it("names one suite run item per scenario run", async () => {
      const suite = makeSuitePipeline();
      const subscriber = createSuiteRunSyncSubscriber(suite.deps);

      await subscriber.handler(finishedEvent("run-1"), contextFor("run-1"));
      await subscriber.handler(finishedEvent("run-2"), contextFor("run-2"));

      expect(suite.items().size).toBe(2);
    });
  });
});
