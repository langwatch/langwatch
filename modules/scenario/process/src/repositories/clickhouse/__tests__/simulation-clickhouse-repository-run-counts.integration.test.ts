/**
 * The staff investigation read of scenario runs per project: each run once at its latest version,
 * failures by that version's status, suites counted by scenario set, the empty set id and
 * `default` counted as one.
 * @see modules/staff-access/specs/staff-access-functions-activity.feature
 */

import { nanoid } from "nanoid";
import { describe, expect, it } from "vitest";

import {
  databaseUrl,
  simulationRunRow,
  useSimulationClickHouse,
} from "./simulation-clickhouse-rows.fixture.ts";

const acme = `test-run-counts-${nanoid()}`;
const globex = `test-run-counts-other-${nanoid()}`;
const ch = useSimulationClickHouse({ tenantId: acme });
const other = useSimulationClickHouse({ tenantId: globex });

describe.skipIf(databaseUrl === null)("scenario runs per project", () => {
  /** @scenario "Scenario runs per project count each run once at its latest version" */
  it("counts each run once, failures by their latest status, suites by scenario set", async () => {
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    const rewritten = simulationRunRow({
      tenantId: acme,
      scenarioSetId: "set-a",
      batchRunId: "batch-1",
      metadata: null,
      startedAt,
    });
    await ch.insertRows([
      { ...rewritten, Status: "IN_PROGRESS" },
      { ...rewritten, Status: "FAILED", UpdatedAt: new Date(startedAt.getTime() + 5_000) },
      simulationRunRow({
        tenantId: acme,
        scenarioSetId: "set-a",
        batchRunId: "batch-1",
        metadata: null,
        startedAt,
      }),
      simulationRunRow({
        tenantId: acme,
        scenarioSetId: "set-b",
        batchRunId: "batch-2",
        metadata: null,
        startedAt,
      }),
    ]);
    await other.insertRows([
      simulationRunRow({
        tenantId: globex,
        scenarioSetId: "",
        batchRunId: "batch-3",
        metadata: null,
        startedAt,
      }),
      simulationRunRow({
        tenantId: globex,
        scenarioSetId: "default",
        batchRunId: "batch-4",
        metadata: null,
        startedAt,
      }),
    ]);

    const counts = await ch.repo.findRunCountsByProject({
      projectIds: [acme, globex],
      since: startedAt.getTime() - 60_000,
      until: Date.now() + 60_000,
    });

    expect(counts.toSorted((a, b) => a.projectId.localeCompare(b.projectId))).toEqual(
      [
        { projectId: acme, runs: 3, suites: 2, failedRuns: 1 },
        { projectId: globex, runs: 2, suites: 1, failedRuns: 0 },
      ].toSorted((a, b) => a.projectId.localeCompare(b.projectId)),
    );
  });
});
