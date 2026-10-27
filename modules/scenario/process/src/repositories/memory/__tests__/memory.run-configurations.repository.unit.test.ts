import { createTenantId } from "@langwatch/eventing";
import type { ResultsFilter } from "@langwatch/scenario-contract";
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

/** The metadata the platform stamps on a run it pointed at a target. */
function stamped({
  ref = "agent-1",
  key = ref,
  type = "http",
  targetParameters,
  parameters,
  note,
  simulatorModel = "openai/gpt-5",
  judgeModel = "openai/gpt-5-mini",
}: {
  ref?: string;
  key?: string;
  type?: string;
  targetParameters?: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  note?: string;
  simulatorModel?: string;
  judgeModel?: string;
}): string {
  return JSON.stringify({
    ...(note && { note }),
    ...(parameters && { parameters }),
    langwatch: {
      targetReferenceId: ref,
      targetKey: key,
      targetType: type,
      simulatorModel,
      judgeModel,
      ...(targetParameters && { targetParameters }),
    },
  });
}

async function given(runs: SimulationRunStateData[]) {
  const repositories = MemoryScenarioRepositories.create();
  const store = repositories.simulationRunProcessing.runStateStore({
    defaultRetentionDays: () => 30,
  });
  for (const state of runs) {
    await store.store(state, {
      tenantId: createTenantId(PROJECT),
      aggregateId: state.ScenarioRunId,
    });
  }
  return repositories.runConfigurations;
}

describe("MemoryRunConfigurationsRepository", () => {
  describe("when the configurations a plan ran with are read (findConfigurations)", () => {
    it("answers one run plan execution as its targets, repeat count, models, parameters and note use", async () => {
      const configurations = await given([
        runState({
          ScenarioRunId: "r-1",
          ScenarioId: "s-1",
          StartedAt: 1_000,
          Metadata: stamped({ parameters: { tone: "warm" }, note: "first try" }),
        }),
        runState({
          ScenarioRunId: "r-2",
          ScenarioId: "s-1",
          StartedAt: 1_200,
          Metadata: stamped({}),
        }),
        runState({
          ScenarioRunId: "r-3",
          ScenarioId: "s-2",
          StartedAt: 1_100,
          Metadata: stamped({}),
        }),
      ]);

      expect(await configurations.findConfigurations({ filter: filter() })).toEqual([
        {
          SetId: "set-1",
          TargetPairs: ["http:agent-1"],
          TargetParameters: [""],
          RepeatCount: "2",
          SimulatorModel: "openai/gpt-5",
          JudgeModel: "openai/gpt-5-mini",
          Parameters: '{"tone":"warm"}',
          FirstTargetParameters: "",
          UsesNote: "1",
          LastRunAtMs: "1200",
        },
      ]);
    });

    it("folds two executions of one configuration into one row, and keeps a different one apart, newest first", async () => {
      const configurations = await given([
        runState({
          ScenarioRunId: "r-1",
          BatchRunId: "b-1",
          StartedAt: 1_000,
          Metadata: stamped({}),
        }),
        runState({
          ScenarioRunId: "r-2",
          BatchRunId: "b-2",
          StartedAt: 3_000,
          Metadata: stamped({}),
        }),
        runState({
          ScenarioRunId: "r-3",
          BatchRunId: "b-3",
          StartedAt: 2_000,
          Metadata: stamped({ judgeModel: "anthropic/claude" }),
        }),
      ]);

      const rows = await configurations.findConfigurations({ filter: filter() });

      expect(rows.map((row) => [row.JudgeModel, row.LastRunAtMs])).toEqual([
        ["openai/gpt-5-mini", "3000"],
        ["anthropic/claude", "2000"],
      ]);
      expect(rows[0]?.UsesNote).toBe("0");
      const [newest] = await configurations.findConfigurations({ filter: filter(), limit: 1 });
      expect(newest?.LastRunAtMs).toBe("3000");
    });

    it("reads the parameters off the plain target when a variant ran beside it, else off the first run", async () => {
      const variant = { key: "agent-1:abc", targetParameters: { temperature: 0.2 } };
      const configurations = await given([
        runState({
          ScenarioRunId: "a-1",
          BatchRunId: "mixed",
          Metadata: stamped({ ...variant, parameters: { from: "variant" } }),
        }),
        runState({
          ScenarioRunId: "a-2",
          BatchRunId: "mixed",
          Metadata: stamped({ parameters: { from: "plain" } }),
        }),
        runState({
          ScenarioRunId: "b-1",
          BatchRunId: "variants",
          ScenarioSetId: "set-2",
          Metadata: stamped({ ...variant, parameters: { from: "only variant" } }),
        }),
      ]);

      const rows = await configurations.findConfigurations({ filter: filter() });
      const bySet = new Map(rows.map((row) => [row.SetId, row]));

      expect(bySet.get("set-1")).toMatchObject({
        TargetPairs: ["http:agent-1", "http:agent-1:abc"],
        TargetParameters: ["", '{"temperature":0.2}'],
        Parameters: '{"from":"plain"}',
        FirstTargetParameters: "",
      });
      expect(bySet.get("set-2")).toMatchObject({
        Parameters: '{"from":"only variant"}',
        FirstTargetParameters: '{"temperature":0.2}',
      });
    });

    it("leaves out runs pushed from code, and answers nothing for an empty list of sets", async () => {
      const configurations = await given([
        runState({ ScenarioRunId: "code", Metadata: JSON.stringify({ parameters: { a: 1 } }) }),
        runState({ ScenarioRunId: "platform", ScenarioSetId: "set-2", Metadata: stamped({}) }),
      ]);

      const rows = await configurations.findConfigurations({ filter: filter() });

      expect(rows.map((row) => row.SetId)).toEqual(["set-2"]);
      expect(
        await configurations.findConfigurations({ filter: filter({ scenarioSetIds: [] }) }),
      ).toEqual([]);
    });
  });
});
