import { describe, expect, it, vi } from "vitest";

import { getSuiteSetId } from "@langwatch/suite-contract";

import { SIMULATION_RUN_EVENT_TYPES } from "../../src/adapters/simulation-run.adapter";
import type { SimulationProcessingEvent } from "../../src/adapters/simulation-run.adapter";
import {
  createSuiteRunSyncSubscriber,
  type SuiteRunSyncSubscriberDeps,
} from "../../src/subscribers/suite-run-sync.subscriber";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const SUITE_SET_ID = getSuiteSetId("suite-1");
const PLAIN_SET_ID = "set-1";

function makeEvent(overrides: {
  type: SimulationProcessingEvent["type"];
  occurredAt?: number;
  data: Record<string, unknown>;
}): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: overrides.occurredAt ?? 1_000,
    occurredAt: overrides.occurredAt ?? 1_000,
    version: "2026-08-06",
    ...overrides,
  } as SimulationProcessingEvent;
}

function startedEvent(scenarioSetId: string): SimulationProcessingEvent {
  return makeEvent({
    type: SIMULATION_RUN_EVENT_TYPES.STARTED,
    occurredAt: 2_000,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId,
    },
  });
}

function finishedEvent(overrides: Record<string, unknown> = {}): SimulationProcessingEvent {
  return makeEvent({
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    occurredAt: 5_000,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: SUITE_SET_ID,
      status: "SUCCESS",
      durationMs: 1_500,
      results: {
        verdict: "success",
        reasoning: "all criteria met",
        metCriteria: ["criterion-1"],
        unmetCriteria: [],
      },
      ...overrides,
    },
  });
}

function makeDeps(overrides: Partial<SuiteRunSyncSubscriberDeps> = {}): SuiteRunSyncSubscriberDeps {
  return {
    recordSuiteRunItemStarted: vi.fn().mockResolvedValue(undefined),
    completeSuiteRunItem: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const CONTEXT = {
  tenantId: "project-1",
  aggregateId: "run-1",
  state: undefined,
};

describe("suiteRunSync subscriber", () => {
  describe("when a suite run starts", () => {
    it("dispatches recordSuiteRunItemStarted mapped from the event", async () => {
      const deps = makeDeps();
      const subscriber = createSuiteRunSyncSubscriber(deps);

      await subscriber.handler(startedEvent(SUITE_SET_ID), CONTEXT);

      expect(deps.recordSuiteRunItemStarted).toHaveBeenCalledWith({
        tenantId: "project-1",
        batchRunId: "batch-1",
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        occurredAt: 2_000,
      });
    });
  });

  describe("when a suite run finishes", () => {
    it("dispatches completeSuiteRunItem with the outcome from data.results", async () => {
      const deps = makeDeps();
      const subscriber = createSuiteRunSyncSubscriber(deps);

      await subscriber.handler(finishedEvent(), CONTEXT);

      expect(deps.completeSuiteRunItem).toHaveBeenCalledWith({
        tenantId: "project-1",
        batchRunId: "batch-1",
        scenarioRunId: "run-1",
        scenarioId: "scenario-1",
        status: "SUCCESS",
        verdict: "success",
        durationMs: 1_500,
        reasoning: "all criteria met",
        error: undefined,
        occurredAt: 5_000,
      });
    });
  });

  describe("when the run does not belong to a suite", () => {
    it("skips started events for plain scenario sets", async () => {
      const deps = makeDeps();
      const subscriber = createSuiteRunSyncSubscriber(deps);

      await subscriber.handler(startedEvent(PLAIN_SET_ID), CONTEXT);

      expect(deps.recordSuiteRunItemStarted).not.toHaveBeenCalled();
    });

    it("skips finished events for plain scenario sets", async () => {
      const deps = makeDeps();
      const subscriber = createSuiteRunSyncSubscriber(deps);

      await subscriber.handler(finishedEvent({ scenarioSetId: PLAIN_SET_ID }), CONTEXT);

      expect(deps.completeSuiteRunItem).not.toHaveBeenCalled();
    });
  });

  describe("when a finished event lacks the ECST identity fields", () => {
    it.each([
      ["batchRunId", { batchRunId: undefined }],
      ["scenarioId", { scenarioId: undefined }],
      ["status", { status: undefined }],
    ])("skips the dispatch when %s is missing", async (_field, dataOverride) => {
      const deps = makeDeps();
      const subscriber = createSuiteRunSyncSubscriber(deps);

      await subscriber.handler(finishedEvent(dataOverride), CONTEXT);

      expect(deps.completeSuiteRunItem).not.toHaveBeenCalled();
    });
  });

  describe("when the dispatch fails", () => {
    it("propagates the error so the GroupQueue retries", async () => {
      const deps = makeDeps({
        recordSuiteRunItemStarted: vi.fn().mockRejectedValue(new Error("suite pipeline down")),
      });
      const subscriber = createSuiteRunSyncSubscriber(deps);

      await expect(subscriber.handler(startedEvent(SUITE_SET_ID), CONTEXT)).rejects.toThrow(
        "suite pipeline down",
      );
    });
  });
});
