/**
 * @vitest-environment node
 * The staff read of scenario runs per project, stated once and run against every simulation
 * repository the package builds without a server: the memory twin of the ClickHouse read.
 */
import { createTenantId } from "@langwatch/eventing";
import type { SimulationProjectRunCount } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { simulationRunState as runState } from "../../__tests__/support/simulation-run-state.fixture.ts";
import type { SimulationRunStateData } from "../../eventing/simulation-run-state.projection.ts";
import { MemoryScenarioRepositories } from "../memory/memory.scenario.repositories.ts";
import type { SimulationRepository } from "../simulation.repository.ts";

const ACME = "project-acme";
const GLOBEX = "project-globex";
const HOUR_MS = 60 * 60 * 1000;
const STARTED_AT = 1_800_000_000_000;

type StoredRun = { projectId: string; state: SimulationRunStateData };

type Backend = Readonly<{
  name: string;
  given: (runs: readonly StoredRun[]) => Promise<SimulationRepository>;
}>;

const backends: readonly Backend[] = [
  {
    name: "memory",
    given: async (runs) => {
      const repositories = MemoryScenarioRepositories.create();
      const store = repositories.simulationRunProcessing.runStateStore({
        defaultRetentionDays: () => 30,
      });
      for (const { projectId, state } of runs) {
        await store.store(state, {
          tenantId: createTenantId(projectId),
          aggregateId: state.ScenarioRunId,
        });
      }
      return repositories.simulations;
    },
  },
];

function run({
  projectId = ACME,
  ...overrides
}: Partial<SimulationRunStateData> & { ScenarioRunId: string; projectId?: string }): StoredRun {
  return {
    projectId,
    state: runState({ StartedAt: STARTED_AT, CreatedAt: STARTED_AT, ...overrides }),
  };
}

function byProject(counts: readonly SimulationProjectRunCount[]): SimulationProjectRunCount[] {
  return counts.toSorted((a, b) => a.projectId.localeCompare(b.projectId));
}

describe.each(backends)("given the $name simulation repository", ({ given }) => {
  describe("when scenario runs are counted per project (findRunCountsByProject)", () => {
    it("counts each run once, failures by their latest status, suites by scenario set", async () => {
      const simulations = await given([
        run({
          ScenarioRunId: "rewritten",
          ScenarioSetId: "set-a",
          BatchRunId: "batch-1",
          Status: "IN_PROGRESS",
          UpdatedAt: STARTED_AT,
        }),
        run({
          ScenarioRunId: "rewritten",
          ScenarioSetId: "set-a",
          BatchRunId: "batch-1",
          Status: "FAILED",
          UpdatedAt: STARTED_AT + 5_000,
        }),
        run({ ScenarioRunId: "passed", ScenarioSetId: "set-a", BatchRunId: "batch-1" }),
        run({ ScenarioRunId: "other-set", ScenarioSetId: "set-b", BatchRunId: "batch-2" }),
        run({
          projectId: GLOBEX,
          ScenarioRunId: "empty-set",
          ScenarioSetId: "",
          BatchRunId: "batch-3",
        }),
        run({
          projectId: GLOBEX,
          ScenarioRunId: "default-set",
          ScenarioSetId: "default",
          BatchRunId: "batch-4",
        }),
      ]);

      const counts = await simulations.findRunCountsByProject({
        projectIds: [ACME, GLOBEX],
        since: STARTED_AT - 60_000,
        until: STARTED_AT + HOUR_MS,
      });

      expect(byProject(counts)).toEqual([
        { projectId: ACME, runs: 3, suites: 2, failedRuns: 1 },
        { projectId: GLOBEX, runs: 2, suites: 1, failedRuns: 0 },
      ]);
    });

    it("counts a run started exactly at since, never one started at until or before since", async () => {
      const simulations = await given([
        run({ ScenarioRunId: "at-since", StartedAt: STARTED_AT }),
        run({ ScenarioRunId: "before-since", StartedAt: STARTED_AT - 1 }),
        run({ ScenarioRunId: "at-until", StartedAt: STARTED_AT + HOUR_MS }),
      ]);

      await expect(
        simulations.findRunCountsByProject({
          projectIds: [ACME],
          since: STARTED_AT,
          until: STARTED_AT + HOUR_MS,
        }),
      ).resolves.toEqual([{ projectId: ACME, runs: 1, suites: 1, failedRuns: 0 }]);
    });

    it("calls only FAILED and ERROR failed, at the run's latest status", async () => {
      const simulations = await given([
        run({ ScenarioRunId: "failed", Status: "FAILED" }),
        run({ ScenarioRunId: "errored", Status: "ERROR" }),
        run({ ScenarioRunId: "cancelled", Status: "CANCELLED" }),
        run({ ScenarioRunId: "stalled", Status: "STALLED" }),
        run({ ScenarioRunId: "running", Status: "IN_PROGRESS", FinishedAt: null }),
        run({ ScenarioRunId: "passed", Status: "SUCCESS" }),
        run({ ScenarioRunId: "recovered", Status: "ERROR", UpdatedAt: 2_000 }),
        run({ ScenarioRunId: "recovered", Status: "SUCCESS", UpdatedAt: 3_000 }),
      ]);

      await expect(
        simulations.findRunCountsByProject({
          projectIds: [ACME],
          since: STARTED_AT,
          until: STARTED_AT + HOUR_MS,
        }),
      ).resolves.toEqual([{ projectId: ACME, runs: 7, suites: 1, failedRuns: 2 }]);
    });

    it("leaves out archived runs, projects with nothing in the window and projects not asked", async () => {
      const simulations = await given([
        run({ ScenarioRunId: "kept", ScenarioSetId: "set-a" }),
        run({ ScenarioRunId: "archived", ScenarioSetId: "set-b", Status: "FAILED" }),
        run({
          ScenarioRunId: "archived",
          ScenarioSetId: "set-b",
          Status: "FAILED",
          ArchivedAt: STARTED_AT + 10_000,
          UpdatedAt: STARTED_AT + 10_000,
        }),
        run({ projectId: GLOBEX, ScenarioRunId: "too-old", StartedAt: STARTED_AT - HOUR_MS }),
        run({ projectId: "project-initech", ScenarioRunId: "not-asked" }),
      ]);

      await expect(
        simulations.findRunCountsByProject({
          projectIds: [ACME, GLOBEX, ACME],
          since: STARTED_AT,
          until: STARTED_AT + HOUR_MS,
        }),
      ).resolves.toEqual([{ projectId: ACME, runs: 1, suites: 1, failedRuns: 0 }]);
    });

    it("answers no rows when no project is named", async () => {
      const simulations = await given([run({ ScenarioRunId: "run-1" })]);

      await expect(
        simulations.findRunCountsByProject({
          projectIds: [],
          since: STARTED_AT,
          until: STARTED_AT + HOUR_MS,
        }),
      ).resolves.toEqual([]);
    });
  });
});
