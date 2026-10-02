/** One simulation_runs row builder, insert and per-tenant cleanup for the ClickHouse suites. */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
export const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

export function simulationRunRow({
  tenantId,
  scenarioSetId,
  batchRunId,
  metadata,
  startedAt = new Date(Date.now() - 5000),
}: {
  tenantId: string;
  scenarioSetId: string;
  batchRunId: string;
  metadata: Record<string, unknown> | null;
  startedAt?: Date;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: batchRunId,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: "SUCCESS",
    Name: "Refund Flow",
    Description: null,
    Metadata: metadata === null ? null : JSON.stringify(metadata),
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": ["trace-1"],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: ["criterion-1"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: new Date(startedAt.getTime() + 1000),
    FinishedAt: new Date(startedAt.getTime() + 1000),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
  };
}

/** Opens a client before the suite and deletes the tenant's rows after it. */
export function useSimulationClickHouse({ tenantId }: { tenantId: string }) {
  let client: ClickHouseClient | undefined;
  let repo: SimulationClickHouseRepository | undefined;

  beforeAll(() => {
    if (!databaseUrl) return;
    const opened = createClient({
      url: databaseUrl,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    client = opened;
    repo = SimulationClickHouseRepository.create(async () => opened);
  });

  afterAll(async () => {
    if (!client) return;
    await client.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await client.close();
    client = undefined;
  });

  return {
    get client() {
      if (!client) throw new Error("ClickHouse integration environment is unavailable");
      return client;
    },
    get repo() {
      if (!repo) throw new Error("ClickHouse integration environment is unavailable");
      return repo;
    },
    async insertRows(rows: readonly Record<string, unknown>[]) {
      if (!client) throw new Error("ClickHouse integration environment is unavailable");
      await client.insert({
        table: "simulation_runs",
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
    },
  };
}
