/**
 * The scenario-set list and the scenarios table's last-result cells over real rows: latest
 * versions only, archived runs and agent test runs left out (ADR-202 built reads).
 */

import { getAgentTestSetId } from "@langwatch/scenario-contract";
import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import {
  databaseUrl,
  simulationRunRow,
  useSimulationClickHouse,
} from "./simulation-clickhouse-rows.fixture.ts";

const tenantId = `test-set-list-${nanoid()}`;
const now = Date.now();

const ch = useSimulationClickHouse({ tenantId });

const run = (scenarioSetId: string) =>
  simulationRunRow({ tenantId, scenarioSetId, batchRunId: `batch-${nanoid(6)}`, metadata: null });

/** A later version of a run, archived. */
const archived = (row: ReturnType<typeof run>) => ({
  ...row,
  ProjectionId: `proj-${nanoid()}`,
  UpdatedAt: new Date(row.UpdatedAt.getTime() + 1_000),
  ArchivedAt: new Date(row.UpdatedAt.getTime() + 1_000),
});

describe.skipIf(databaseUrl === null)(
  "SimulationClickHouseRepository.findScenarioSetsData()",
  () => {
    describe("given live, archived and agent test runs", () => {
      it("counts each set's live runs, the default set under its one id", async () => {
        const kept = run("set-a");
        const gone = run("set-a");
        await ch.insertRows([
          run(""),
          kept,
          gone,
          archived(gone),
          run(getAgentTestSetId(tenantId)),
        ]);

        const sets = await ch.repo.findScenarioSetsData({ projectId: tenantId });

        expect(
          sets.map(({ scenarioSetId, scenarioCount }) => ({ scenarioSetId, scenarioCount })),
        ).toEqual(
          expect.arrayContaining([
            { scenarioSetId: "default", scenarioCount: 1 },
            { scenarioSetId: "set-a", scenarioCount: 1 },
          ]),
        );
        expect(sets).toHaveLength(2);
        expect(sets.every((set) => set.lastRunAt > 0)).toBe(true);
      });
    });
  },
);

describe.skipIf(databaseUrl === null)(
  "SimulationClickHouseRepository.findLastResultSummaries()",
  () => {
    describe("given a scenario's older and newer runs, and a newer agent test run", () => {
      it("answers the newer live run, a missing duration as null", async () => {
        const scenarioId = `scenario-${nanoid()}`;
        const older = { ...run("set-b"), ScenarioId: scenarioId, DurationMs: 1_234 };
        const newer = {
          ...run("set-b"),
          ScenarioId: scenarioId,
          Status: "FAILED",
          DurationMs: null,
          UpdatedAt: new Date(now + 5_000),
        };
        const agentTest = {
          ...run(getAgentTestSetId(tenantId)),
          ScenarioId: scenarioId,
          UpdatedAt: new Date(now + 9_000),
        };
        await ch.insertRows([older, newer, agentTest]);

        const [summary, ...rest] = await ch.repo.findLastResultSummaries({
          projectId: tenantId,
          scenarioIds: [scenarioId],
        });

        expect(rest).toHaveLength(0);
        expect(summary).toMatchObject({
          scenarioId,
          batchRunId: newer.BatchRunId,
          scenarioSetId: "set-b",
          durationInMs: null,
        });
      });
    });

    describe("given the newest version of the newest run is archived", () => {
      it("answers the older live run", async () => {
        const scenarioId = `scenario-${nanoid()}`;
        const older = { ...run("set-c"), ScenarioId: scenarioId, DurationMs: 1_234 };
        const newer = { ...run("set-c"), ScenarioId: scenarioId, UpdatedAt: new Date(now + 5_000) };
        await ch.insertRows([older, newer, archived(newer)]);

        const summaries = await ch.repo.findLastResultSummaries({
          projectId: tenantId,
          scenarioIds: [scenarioId],
        });

        expect(summaries).toEqual([
          expect.objectContaining({ batchRunId: older.BatchRunId, durationInMs: 1_234 }),
        ]);
      });
    });
  },
);
