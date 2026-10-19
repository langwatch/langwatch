import { createTenantId } from "@langwatch/eventing";
import { SimulationRunStatus, type SimulationRunData } from "@langwatch/scenario-contract";
import {
  SUITE_RUN_EVENT_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
  type CompleteSuiteRunItemCommandData,
  type RecordSuiteRunItemStartedCommandData,
  type SuiteRunStateData,
} from "@langwatch/suite-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { SuiteRunStateFoldProjection } from "../../eventing/suite-run-state.projection.ts";
import {
  CompleteSuiteRunItemCommand,
  RecordSuiteRunItemStartedCommand,
} from "../../eventing/suite-run.commands.ts";
import { MemorySuiteRunProcessingRepository } from "../../repositories/memory/memory.suite.repositories.ts";
import { SuiteRunReplayService } from "../suite-run-replay.service.ts";

const TENANT = "project-1";
const BATCH = "batch-1";
const SET = "__internal__suite-1__suite";

function openRun(overrides: Partial<SuiteRunStateData> = {}): SuiteRunStateData {
  return {
    SuiteRunId: "suite-run-1",
    BatchRunId: BATCH,
    ScenarioSetId: SET,
    SuiteId: "suite-1",
    Status: "IN_PROGRESS",
    Total: 2,
    StartedCount: 0,
    CompletedCount: 0,
    FailedCount: 0,
    Progress: 0,
    PassRateBps: null,
    CreatedAt: 1000,
    UpdatedAt: 1000,
    LastEventOccurredAt: 1000,
    StartedAt: 1000,
    FinishedAt: null,
    PassedCount: 0,
    GradedCount: 0,
    ...overrides,
  };
}

function scenarioRun(overrides: Partial<SimulationRunData>): SimulationRunData {
  return {
    scenarioId: "scenario-1",
    batchRunId: BATCH,
    scenarioRunId: "run-1",
    scenarioSetId: SET,
    metadata: {},
    status: SimulationRunStatus.IN_PROGRESS,
    messages: [],
    timestamp: 2000,
    durationInMs: 10,
    ...overrides,
  } as SimulationRunData;
}

/** The suite run fold over the memory twin, with each command collapsed on its item key. */
function suiteOverMemory(seed: SuiteRunStateData) {
  const repository = MemorySuiteRunProcessingRepository.create();
  const store = repository.openRunStateFoldStore();
  const projection = SuiteRunStateFoldProjection.create({ store });
  const context = { aggregateId: BATCH, tenantId: createTenantId(TENANT) };
  const admitted = new Set<string>();
  const sent: string[] = [];
  const current = async (): Promise<SuiteRunStateData> => {
    const read = await store.get(BATCH, context);
    if (read.kind === "empty") throw new Error("no suite run held");
    return read.state;
  };
  const admit = (key: string): boolean => {
    sent.push(key);
    if (admitted.has(key)) return false;
    admitted.add(key);
    return true;
  };
  const base = {
    aggregateId: BATCH,
    aggregateType: "suite_run" as const,
    tenantId: context.tenantId,
  };
  const runItems = {
    async recordSuiteRunItemStarted(data: RecordSuiteRunItemStartedCommandData) {
      if (!admit(RecordSuiteRunItemStartedCommand.makeJobId!(data))) return;
      const { tenantId: _tenant, occurredAt, ...eventData } = data;
      const state = projection.handleSuiteRunItemStarted(
        {
          ...base,
          id: `started-${data.scenarioRunId}`,
          createdAt: occurredAt,
          occurredAt,
          type: SUITE_RUN_EVENT_TYPES.ITEM_STARTED,
          version: SUITE_RUN_EVENT_VERSIONS.ITEM_STARTED,
          data: eventData,
        },
        await current(),
      );
      await store.store(state, context);
    },
    async completeSuiteRunItem(data: CompleteSuiteRunItemCommandData) {
      if (!admit(CompleteSuiteRunItemCommand.makeJobId!(data))) return;
      const { tenantId: _tenant, occurredAt, ...eventData } = data;
      const state = projection.handleSuiteRunItemCompleted(
        {
          ...base,
          id: `completed-${data.scenarioRunId}`,
          createdAt: occurredAt,
          occurredAt,
          type: SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED,
          version: SUITE_RUN_EVENT_VERSIONS.ITEM_COMPLETED,
          data: eventData,
        },
        await current(),
      );
      await store.store(state, context);
    },
  };
  return {
    repository,
    store,
    context,
    runItems,
    sent,
    current,
    seed: () => store.store(seed, context),
  };
}

function replayOver({
  suite,
  runs,
}: {
  suite: ReturnType<typeof suiteOverMemory>;
  runs: SimulationRunData[];
}) {
  const saved: string[] = [];
  const service = SuiteRunReplayService.create({
    suites: { findProjectIdsHoldingSuites: async () => [TENANT] },
    runs: suite.repository,
    scenarios: {
      getRunDataForBatchRun: async () => ({ changed: true, lastUpdatedAt: 3000, runs }),
    },
    runItems: suite.runItems,
  });
  const run = (dryRun: boolean, afterTenantId: string | null = null) =>
    service.replayOpenRuns({
      dryRun,
      signal: new AbortController().signal,
      afterTenantId,
      onTenantDone: async ({ tenantId }) => void saved.push(tenantId),
    });
  return { run, saved };
}

const inFlight = [
  scenarioRun({
    scenarioRunId: "run-1",
    status: SimulationRunStatus.SUCCESS,
    results: { verdict: "success", metCriteria: [], unmetCriteria: [] } as never,
  }),
  scenarioRun({
    scenarioRunId: "run-2",
    scenarioId: "scenario-2",
    status: SimulationRunStatus.IN_PROGRESS,
  }),
];

describe("SuiteRunReplayService", () => {
  describe("when an open suite run is behind scenario's runs", () => {
    let suite: ReturnType<typeof suiteOverMemory>;
    let run: ReturnType<typeof replayOver>["run"];

    beforeEach(async () => {
      suite = suiteOverMemory(openRun());
      await suite.seed();
      ({ run } = replayOver({ suite, runs: inFlight }));
    });

    /** @scenario "An open suite run behind scenario's runs counts each item once" */
    it("counts each started and finished item once", async () => {
      await run(false);

      expect(await suite.current()).toMatchObject({
        StartedCount: 2,
        CompletedCount: 1,
        PassedCount: 1,
        GradedCount: 1,
      });
    });

    /** @scenario "A second replay changes nothing" */
    it("changes nothing and sends nothing on a second run", async () => {
      await run(false);
      const after = await suite.current();
      const sentBefore = suite.sent.length;

      const second = await run(false);

      expect(await suite.current()).toEqual(after);
      expect(suite.sent.length).toBe(sentBefore);
      expect(second).toMatchObject({ openRuns: 1, behindRuns: 0, startsSent: 0, finishesSent: 0 });
    });

    /** @scenario "A dry run reports and writes nothing" */
    it("reports what it would send, sends nothing and saves no checkpoint", async () => {
      const dry = replayOver({ suite, runs: inFlight });

      const report = await dry.run(true);

      expect(report).toMatchObject({ behindRuns: 1, startsSent: 2, finishesSent: 1 });
      expect(suite.sent).toEqual([]);
      expect(dry.saved).toEqual([]);
      expect(await suite.current()).toMatchObject({ StartedCount: 0 });
    });

    /** @scenario "A resumed replay skips the tenants already done" */
    it("skips the tenants already done", async () => {
      const report = await run(false, TENANT);

      expect(report.openRuns).toBe(0);
      expect(suite.sent).toEqual([]);
    });
  });

  describe("when the suite run already counts every item scenario holds", () => {
    /** @scenario "A suite run already level with scenario is left alone" */
    it("sends nothing", async () => {
      const suite = suiteOverMemory(
        openRun({ StartedCount: 2, CompletedCount: 1, PassedCount: 1, GradedCount: 1 }),
      );
      await suite.seed();
      const { run } = replayOver({ suite, runs: inFlight });

      const report = await run(false);

      expect(suite.sent).toEqual([]);
      expect(report).toMatchObject({ behindRuns: 0, gradeDriftRuns: 0 });
    });
  });

  describe("when a counted item's grade moved after suite counted it", () => {
    /** @scenario "A grade that moved after suite counted it is reported, not regraded" */
    it("reports the drift and sends no regrade", async () => {
      const suite = suiteOverMemory(
        openRun({ StartedCount: 2, CompletedCount: 1, PassedCount: 0, GradedCount: 1 }),
      );
      await suite.seed();
      const { run } = replayOver({ suite, runs: inFlight });

      const report = await run(false);

      expect(suite.sent).toEqual([]);
      expect(report.gradeDriftRuns).toBe(1);
    });
  });

  describe("when the suite run has finished", () => {
    /** @scenario "A finished suite run is not replayed" */
    it("leaves it alone", async () => {
      const suite = suiteOverMemory(openRun({ Status: "SUCCESS" }));
      await suite.seed();
      const { run } = replayOver({ suite, runs: inFlight });

      const report = await run(false);

      expect(report.openRuns).toBe(0);
      expect(suite.sent).toEqual([]);
    });
  });
});
