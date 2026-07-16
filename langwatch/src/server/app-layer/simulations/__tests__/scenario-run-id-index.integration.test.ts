/**
 * @vitest-environment node
 * @integration
 *
 * Verifies the bloom_filter skip-index on simulation_runs.ScenarioRunId
 * (migration 00043):
 *  - the migration attaches idx_scenario_run_id to the table, and
 *  - the (TenantId, ScenarioRunId) point-lookup shapes still return the right
 *    rows.
 *
 * simulation_runs is PARTITION BY toYearWeek(StartedAt), so a single-run lookup
 * carries no StartedAt predicate and cannot prune partitions: the primary key
 * lands on one candidate granule in every part and, without a skip index on
 * ScenarioRunId, reads all of them. The index lets ClickHouse skip granules
 * that cannot contain the id. Correctness is identical either way, which is
 * what this test pins.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";

let ch: ClickHouseClient;
const tag = nanoid();

async function insertRun({
  tenantId,
  scenarioRunId,
  status,
  startedAt,
  updatedAt,
}: {
  tenantId: string;
  scenarioRunId: string;
  status: string;
  startedAt: Date;
  updatedAt: Date;
}) {
  await ch.insert({
    table: "simulation_runs",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        ScenarioRunId: scenarioRunId,
        ScenarioId: `${tag}-scenario`,
        BatchRunId: `${tag}-batch`,
        ScenarioSetId: `${tag}-set`,
        Version: "v1",
        Status: status,
        Name: "test run",
        Description: null,
        // Nested Messages.* arrays must all be the same length.
        "Messages.Id": ["m1"],
        "Messages.Role": ["user"],
        "Messages.Content": ["hello"],
        "Messages.TraceId": [`${tag}-trace`],
        "Messages.Rest": ["{}"],
        TraceIds: [`${tag}-trace`],
        Verdict: null,
        Reasoning: null,
        MetCriteria: [],
        UnmetCriteria: [],
        Error: null,
        DurationMs: 10,
        StartedAt: startedAt,
        CreatedAt: startedAt,
        UpdatedAt: updatedAt,
        FinishedAt: null,
        ArchivedAt: null,
        LastSnapshotOccurredAt: new Date(0),
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** Latest-version single-run lookup: the shape the index affects. */
async function getStatus(tenantId: string, scenarioRunId: string) {
  const rows = await (
    await ch.query({
      query: `
        SELECT argMax(Status, UpdatedAt) AS Status
        FROM simulation_runs
        WHERE TenantId = {tenantId:String}
          AND ScenarioRunId = {scenarioRunId:String}
        HAVING count() > 0
      `,
      query_params: { tenantId, scenarioRunId },
      format: "JSONEachRow",
    })
  ).json<{ Status: string }>();
  return rows[0]?.Status;
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE startsWith(TenantId, {tag:String})`,
      query_params: { tag },
    });
  }
  await stopTestContainers();
});

describe("simulation_runs ScenarioRunId skip-index (migration 00043)", () => {
  it("attaches a bloom_filter index on ScenarioRunId", async () => {
    const ddl = await (
      await ch.query({
        query: "SHOW CREATE TABLE simulation_runs",
        format: "TabSeparatedRaw",
      })
    ).text();
    expect(ddl).toMatch(/INDEX\s+idx_scenario_run_id\b/i);
    expect(ddl).toMatch(/idx_scenario_run_id[\s\S]*TYPE\s+bloom_filter/i);
  });

  describe("when looking up an existing run", () => {
    it("returns the latest version's status", async () => {
      const tenantId = `${tag}-tenant-a`;
      const scenarioRunId = `${tag}-run-1`;
      await insertRun({
        tenantId,
        scenarioRunId,
        status: "IN_PROGRESS",
        startedAt: new Date("2026-01-05T00:00:00.000Z"),
        updatedAt: new Date("2026-01-05T00:00:01.000Z"),
      });
      await insertRun({
        tenantId,
        scenarioRunId,
        status: "SUCCESS",
        startedAt: new Date("2026-01-05T00:00:00.000Z"),
        updatedAt: new Date("2026-01-05T00:00:09.000Z"),
      });
      // A different run in a different partition the lookup must not pick up.
      await insertRun({
        tenantId,
        scenarioRunId: `${tag}-run-2`,
        status: "FAILED",
        startedAt: new Date("2026-03-09T00:00:00.000Z"),
        updatedAt: new Date("2026-03-09T00:00:01.000Z"),
      });

      expect(await getStatus(tenantId, scenarioRunId)).toBe("SUCCESS");
      expect(await getStatus(tenantId, `${tag}-run-2`)).toBe("FAILED");
    });
  });

  describe("when looking up a run that does not exist", () => {
    it("returns no row", async () => {
      expect(
        await getStatus(`${tag}-tenant-a`, `${tag}-missing-run`),
      ).toBeUndefined();
    });
  });

  describe("when two tenants share a scenario run id", () => {
    it("keeps the lookup scoped to the requesting tenant", async () => {
      const scenarioRunId = `${tag}-shared-run`;
      await insertRun({
        tenantId: `${tag}-tenant-b`,
        scenarioRunId,
        status: "SUCCESS",
        startedAt: new Date("2026-04-06T00:00:00.000Z"),
        updatedAt: new Date("2026-04-06T00:00:01.000Z"),
      });
      await insertRun({
        tenantId: `${tag}-tenant-c`,
        scenarioRunId,
        status: "FAILED",
        startedAt: new Date("2026-05-04T00:00:00.000Z"),
        updatedAt: new Date("2026-05-04T00:00:01.000Z"),
      });

      expect(await getStatus(`${tag}-tenant-b`, scenarioRunId)).toBe("SUCCESS");
      expect(await getStatus(`${tag}-tenant-c`, scenarioRunId)).toBe("FAILED");
    });
  });
});
