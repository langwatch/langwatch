import { createTenantId } from "@langwatch/eventing";
import {
  AGENT_TEST_SET_SUFFIX,
  MAX_TREND_POINTS,
  type ResultsFilter,
  SimulationRunStatus,
  UNKNOWN_TARGET_KEY,
  VOICE_CALL_SCENARIO_SET_ID,
} from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { simulationRunState as runState } from "../../../__tests__/support/simulation-run-state.fixture.ts";
import type { SimulationRunStateData } from "../../../eventing/simulation-run-state.projection.ts";
import { MemoryScenarioRepositories } from "../memory.scenario.repositories.ts";

const PROJECT = "project-1";

const filter = (over: Partial<ResultsFilter> = {}): ResultsFilter => ({
  projectId: PROJECT,
  startDate: 0,
  ...over,
});

/** A platform run's metadata: everything the platform knows sits under `langwatch`. */
function platform({
  ref = "agent-1",
  key = ref,
  parameters,
  note,
}: {
  ref?: string;
  key?: string;
  parameters?: Record<string, unknown>;
  note?: string;
}): string {
  return JSON.stringify({
    ...(note && { note }),
    langwatch: {
      targetReferenceId: ref,
      targetKey: key,
      ...(parameters && { targetParameters: parameters }),
    },
  });
}

/** A code run's metadata: the agents the SDK reported, no platform namespace. */
function fromCode(...agents: { name: string; role: string }[]): string {
  return JSON.stringify({ agents });
}

/** Folds the runs through the registry's run processing; the atom twin reads the same fold. */
async function given(runs: (SimulationRunStateData & { projectId?: string })[]) {
  const repositories = MemoryScenarioRepositories.create();
  const store = repositories.simulationRunProcessing.runStateStore({
    defaultRetentionDays: () => 30,
  });
  for (const { projectId = PROJECT, ...state } of runs) {
    await store.store(state, {
      tenantId: createTenantId(projectId),
      aggregateId: state.ScenarioRunId,
    });
  }
  return repositories.resultAtoms;
}

describe("MemoryResultAtomsRepository", () => {
  describe("when atoms are listed (listAtoms)", () => {
    it("names the plan, the run, the scenario, the target, the trigger and the note", async () => {
      const atoms = await given([
        runState({
          ScenarioRunId: "run-1",
          Metadata: platform({ note: "after the prompt change" }),
          Evaluations: [
            {
              evaluatorId: "ev-1",
              name: "Tone",
              status: "passed",
              required: true,
              passed: true,
              score: 0.9,
              label: "polite",
              details: "long prose",
            },
          ],
        }),
      ]);

      const { atoms: page, hasMore } = await atoms.listAtoms({ filter: filter(), limit: 10 });

      expect(hasMore).toBe(false);
      expect(page).toHaveLength(1);
      expect(page[0]).toMatchObject({
        SetId: "set-1",
        BatchRunId: "batch-1",
        ScenarioRunId: "run-1",
        ScenarioId: "scenario-1",
        ScenarioKey: "scenario-1",
        ScenarioName: "Refund flow",
        Status: SimulationRunStatus.SUCCESS,
        Outcome: "passed",
        RunAt: "1000",
        DurationMs: "1500",
        Note: "after the prompt change",
        TargetKey: "agent-1",
        TargetParameters: "",
        Trigger: "app",
        EvaluationIds: ["ev-1"],
        EvaluationRequired: [1],
        EvaluationPassed: [1],
        EvaluationLabels: ["polite"],
      });
    });

    it("keys a run from code by its set and name, and its target by the agent it reported", async () => {
      const atoms = await given([
        runState({
          ScenarioRunId: "run-1",
          ScenarioSetId: "",
          Name: "Refund flow!",
          Metadata: fromCode(
            { name: "List agents", role: "agent" },
            { name: "Simulator", role: "user" },
            { name: "Judge", role: "judge" },
          ),
        }),
        runState({ ScenarioRunId: "run-2", Metadata: fromCode() }),
      ]);

      const { atoms: page } = await atoms.listAtoms({ filter: filter(), limit: 10 });
      const byRun = new Map(page.map((atom) => [atom.ScenarioRunId, atom]));

      expect(byRun.get("run-1")).toMatchObject({
        ScenarioKey: "default-refund-flow",
        Trigger: "code",
        TargetKey: "code:list-agents",
        TargetName: "List agents",
      });
      expect(byRun.get("run-2")).toMatchObject({
        Trigger: "code",
        TargetKey: UNKNOWN_TARGET_KEY,
        TargetName: "",
      });
    });

    it("leaves out archived runs, rows naming no scenario, agent tests, other projects and earlier runs", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "kept", StartedAt: 5_000 }),
        runState({ ScenarioRunId: "archived", StartedAt: 5_000, ArchivedAt: 6_000 }),
        runState({ ScenarioRunId: "no-scenario", StartedAt: 5_000, ScenarioId: "" }),
        runState({
          ScenarioRunId: "agent-test",
          StartedAt: 5_000,
          ScenarioSetId: `agent-1${AGENT_TEST_SET_SUFFIX}`,
        }),
        runState({
          ScenarioRunId: "voice",
          StartedAt: 5_000,
          ScenarioSetId: VOICE_CALL_SCENARIO_SET_ID,
        }),
        { ...runState({ ScenarioRunId: "elsewhere", StartedAt: 5_000 }), projectId: "project-2" },
        runState({ ScenarioRunId: "before", StartedAt: 1_000 }),
      ]);

      const { atoms: page } = await atoms.listAtoms({
        filter: filter({ startDate: 2_000 }),
        limit: 10,
      });

      expect(page.map((atom) => atom.ScenarioRunId)).toEqual(["kept"]);
    });

    it("pages newest first without repeating or dropping an atom, ties broken by run id", async () => {
      const atoms = await given(
        [
          ["a", 1_000],
          ["b", 2_000],
          ["c", 2_000],
          ["d", 3_000],
          ["e", 4_000],
        ].map(([id, at]) => runState({ ScenarioRunId: String(id), StartedAt: Number(at) })),
      );

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const result = await atoms.listAtoms({ filter: filter(), limit: 2, cursor });
        seen.push(...result.atoms.map((atom) => atom.ScenarioRunId));
        cursor = result.nextCursor;
        if (!result.hasMore) break;
      }

      expect(seen).toEqual(["e", "d", "c", "b", "a"]);
    });

    it("keeps only what the filter names: a verdict, a target, a code scenario's key and a set", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "failed", Status: "FAILED", Metadata: platform({}) }),
        runState({ ScenarioRunId: "passed", Metadata: platform({ ref: "agent-2" }) }),
        runState({ ScenarioRunId: "code", ScenarioSetId: "", Name: "Greets" }),
      ]);
      const ids = async (over: Partial<ResultsFilter>) =>
        (await atoms.listAtoms({ filter: filter(over), limit: 10 })).atoms.map(
          (atom) => atom.ScenarioRunId,
        );

      expect(await ids({ outcome: "failed" })).toEqual(["failed"]);
      expect(await ids({ targetKeys: ["agent-2"] })).toEqual(["passed"]);
      expect(await ids({ scenarioIds: ["default-greets"] })).toEqual(["code"]);
      expect(await ids({ scenarioSetIds: ["default"] })).toEqual(["code"]);
      expect(await ids({ scenarioIds: [] })).toEqual([]);
    });

    it("reads the cost from the stored total, the per-trace sums, or none, and unknown otherwise", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "run", TotalCost: 0.5 }),
        runState({
          ScenarioRunId: "traces",
          TraceIds: ["t-1", "t-1", "t-2"],
          TraceMetrics: {
            "t-1": { totalCost: 0.25, roleCosts: {}, roleLatencies: {} },
            "t-2": { totalCost: 0.5, roleCosts: {}, roleLatencies: {} },
          },
        }),
        runState({ ScenarioRunId: "none" }),
        runState({ ScenarioRunId: "unknown", TraceIds: ["t-3"] }),
      ]);

      const { atoms: page } = await atoms.listAtoms({ filter: filter(), limit: 10 });
      const cost = new Map(
        page.map((atom) => [atom.ScenarioRunId, [atom.CostUsd, atom.CostSource]]),
      );

      expect(cost.get("run")).toEqual(["0.5", "run"]);
      expect(cost.get("traces")).toEqual(["0.75", "traces"]);
      expect(cost.get("none")).toEqual(["0", "none"]);
      expect(cost.get("unknown")).toEqual(["", "unknown"]);
    });
  });

  describe("when the runs of a plan are numbered (findRunOrdinals)", () => {
    it("numbers each plan's runs from one, oldest first, by its earliest scenario run", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "r-1", BatchRunId: "late", StartedAt: 3_000 }),
        runState({ ScenarioRunId: "r-2", BatchRunId: "early", StartedAt: 1_000 }),
        runState({ ScenarioRunId: "r-3", BatchRunId: "early", StartedAt: 4_000 }),
        runState({ ScenarioRunId: "r-4", BatchRunId: "middle", StartedAt: 2_000 }),
        runState({ ScenarioRunId: "r-5", BatchRunId: "other", ScenarioSetId: "set-2" }),
      ]);

      const ordinals = await atoms.findRunOrdinals(filter());

      expect(ordinals).toEqual(
        expect.arrayContaining([
          { SetId: "set-1", BatchRunId: "early", RunAt: "1000", Ordinal: "1" },
          { SetId: "set-1", BatchRunId: "middle", RunAt: "2000", Ordinal: "2" },
          { SetId: "set-1", BatchRunId: "late", RunAt: "3000", Ordinal: "3" },
          { SetId: "set-2", BatchRunId: "other", RunAt: "1000", Ordinal: "1" },
        ]),
      );
      expect(ordinals).toHaveLength(4);
    });
  });

  describe("when the stat strip is counted (aggregateTotals)", () => {
    it("counts atoms, verdicts, runs, failing scenarios and the known and unknown cost", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "r-1", TotalCost: 1 }),
        runState({ ScenarioRunId: "r-2", ScenarioId: "s-2", Status: "FAILED", TotalCost: 0.5 }),
        runState({ ScenarioRunId: "r-3", ScenarioId: "s-2", Status: "STALLED", BatchRunId: "b-2" }),
        runState({ ScenarioRunId: "r-4", Status: "IN_PROGRESS", TraceIds: ["t-1"] }),
      ]);

      expect(await atoms.aggregateTotals(filter())).toEqual({
        Atoms: "4",
        Passed: "1",
        Settled: "3",
        RunCount: "2",
        FailingScenarios: "1",
        CostTotal: "1.5",
        CostUnknown: "1",
      });
    });

    it("counts nothing for an empty requested list", async () => {
      const atoms = await given([runState({ ScenarioRunId: "r-1" })]);

      expect(await atoms.aggregateTotals(filter({ targetKeys: [] }))).toMatchObject({
        Atoms: "0",
        CostTotal: "0",
      });
    });
  });

  describe("when the atoms are grouped (aggregateGroups)", () => {
    it("folds two runs reporting the same agent into one target group under the newest names", async () => {
      const atoms = await given([
        runState({
          ScenarioRunId: "r-1",
          StartedAt: 1_000,
          Name: "Old name",
          Metadata: fromCode({ name: "Support bot", role: "agent" }),
        }),
        runState({
          ScenarioRunId: "r-2",
          StartedAt: 2_000,
          ScenarioId: "scenario-2",
          Name: "New name",
          Status: "FAILED",
          BatchRunId: "batch-2",
          Metadata: fromCode({ name: "Support Bot", role: "agent" }),
        }),
      ]);

      const groups = await atoms.aggregateGroups({ filter: filter(), groupBy: "target" });

      expect(groups).toEqual([
        {
          GroupKey: "code:support-bot",
          Name: "New name",
          TargetName: "Support Bot",
          TargetParameters: "",
          Atoms: "2",
          Passed: "1",
          Settled: "2",
          RunCount: "2",
          ScenarioCount: "2",
          LastRunAt: "2000",
          TargetKeys: ["code:support-bot"],
          CostTotal: "0",
          CostUnknown: "0",
        },
      ]);
    });

    it("keeps a plain run and a run with overrides of one agent apart, the variant carrying them", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "plain", Metadata: platform({}) }),
        runState({
          ScenarioRunId: "variant",
          Metadata: platform({ key: "agent-1:abc", parameters: { temperature: 0.2 } }),
        }),
      ]);

      const groups = await atoms.aggregateGroups({ filter: filter(), groupBy: "target" });

      expect(groups.map((group) => [group.GroupKey, group.TargetParameters])).toEqual([
        ["agent-1", ""],
        ["agent-1:abc", '{"temperature":0.2}'],
      ]);
      const byPlan = await atoms.aggregateGroups({ filter: filter(), groupBy: "plan" });
      expect(byPlan.map((group) => [group.GroupKey, group.TargetKeys])).toEqual([
        ["set-1", ["agent-1", "agent-1:abc"]],
      ]);
    });
  });

  describe("when the code scenarios are listed (findCodeScenarios)", () => {
    it("lists each under its key and newest name, in name order, leaving the platform run out", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "r-1", Name: "Zebra", StartedAt: 1_000 }),
        runState({ ScenarioRunId: "r-2", Name: "zebra", StartedAt: 2_000 }),
        runState({ ScenarioRunId: "r-3", Name: "Apple" }),
        runState({ ScenarioRunId: "r-4", Name: "Platform", Metadata: platform({}) }),
      ]);

      expect(await atoms.findCodeScenarios(filter())).toEqual([
        { ScenarioKey: "set-1-apple", Name: "Apple" },
        { ScenarioKey: "set-1-zebra", Name: "zebra" },
      ]);
    });
  });

  describe("when the run targets are listed (findRunTargets)", () => {
    it("lists a variant with its reference id and overrides and a code target, not the plain run", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "plain", Metadata: platform({}) }),
        runState({
          ScenarioRunId: "variant",
          Metadata: platform({ key: "agent-1:abc", parameters: { temperature: 0.2 } }),
        }),
        runState({ ScenarioRunId: "code", Metadata: fromCode({ name: "Bot", role: "agent" }) }),
        runState({ ScenarioRunId: "nameless", Metadata: fromCode() }),
      ]);

      expect(await atoms.findRunTargets(filter())).toEqual([
        {
          TargetKey: "agent-1:abc",
          Name: "",
          ReferenceId: "agent-1",
          TargetParameters: '{"temperature":0.2}',
        },
        { TargetKey: "code:bot", Name: "Bot", ReferenceId: "", TargetParameters: "" },
      ]);
    });
  });

  describe("when the sparklines are read (aggregateTrend)", () => {
    it("folds a plan's bar per run of the plan, newest first", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "r-1", BatchRunId: "b-1", StartedAt: 1_000 }),
        runState({ ScenarioRunId: "r-2", BatchRunId: "b-1", StartedAt: 1_500, Status: "FAILED" }),
        runState({ ScenarioRunId: "r-3", BatchRunId: "b-2", StartedAt: 2_000, Status: "RUNNING" }),
      ]);

      expect(await atoms.aggregateTrend({ filter: filter(), groupBy: "plan" })).toEqual([
        { GroupKey: "set-1", TrendKey: "b-2", RunAt: "2000", Passed: "0", Settled: "0" },
        { GroupKey: "set-1", TrendKey: "b-1", RunAt: "1000", Passed: "1", Settled: "2" },
      ]);
    });

    it("trims each group to the points a sparkline draws, keeping the newest", async () => {
      const atoms = await given(
        Array.from({ length: MAX_TREND_POINTS + 3 }, (_, index) =>
          runState({ ScenarioRunId: `r-${String(index).padStart(2, "0")}`, StartedAt: index }),
        ),
      );

      const trend = await atoms.aggregateTrend({ filter: filter(), groupBy: "scenario" });

      expect(trend).toHaveLength(MAX_TREND_POINTS);
      expect(trend[0]?.RunAt).toBe(String(MAX_TREND_POINTS + 2));
      expect(trend.at(-1)?.RunAt).toBe("3");
    });
  });

  describe("when the pass rate is bucketed (aggregateSeries)", () => {
    it("answers only the buckets that hold a run, oldest first", async () => {
      const atoms = await given([
        runState({ ScenarioRunId: "r-1", StartedAt: 61_000 }),
        runState({ ScenarioRunId: "r-2", StartedAt: 119_000, Status: "FAILED" }),
        runState({ ScenarioRunId: "r-3", StartedAt: 1_000 }),
        runState({ ScenarioRunId: "r-4", StartedAt: 250_000, Status: "QUEUED" }),
      ]);

      expect(await atoms.aggregateSeries({ filter: filter(), bucketSeconds: 60 })).toEqual([
        { Bucket: "0", Passed: "1", Settled: "1" },
        { Bucket: "60000", Passed: "1", Settled: "2" },
        { Bucket: "240000", Passed: "0", Settled: "0" },
      ]);
    });
  });
});
