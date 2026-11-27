/**
 * The shared ClickHouse's query log and health, read from a real server's system tables in a
 * database of this suite's own, so other suites' failures never reach it.
 * @see modules/staff-access/specs/staff-access-functions-telemetry.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { ClickHouseQueryClient, type QueryDriver, TenantGuard } from "@langwatch/clickhouse-client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseClickHouseServerRepository } from "../clickhouse.clickhouse-server.repository.ts";

function queryClientOver(client: ClickHouseClient): ClickHouseQueryClient {
  const driver: QueryDriver = {
    async execute(request) {
      const result = await client.query({
        query: request.sql,
        format: "JSONEachRow",
        ...(request.params === undefined ? {} : { query_params: request.params }),
        ...(request.settings === undefined ? {} : { clickhouse_settings: request.settings }),
      });
      return { rows: await result.json() };
    },
    insert: () => Promise.reject(new Error("this suite never inserts")),
    command: () => Promise.reject(new Error("this suite never commands")),
  };
  return new ClickHouseQueryClient({ tenantGuard: new TenantGuard(), driver });
}

async function failing(promise: Promise<unknown>): Promise<void> {
  await promise.then(
    () => {
      throw new Error("the statement was meant to fail");
    },
    () => undefined,
  );
}

describe("ClickHouseClickHouseServerRepository against ClickHouse", () => {
  let client: ClickHouseClient;
  let repository: ClickHouseClickHouseServerRepository;
  const project = `project_${Date.now()}`;
  const startedAt = Date.now() - 60_000;

  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "ops-clickhouse-server",
      names: ["server"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned");
    client = createClient({ url: endpoint.url });
    repository = ClickHouseClickHouseServerRepository.create({
      clickhouse: queryClientOver(client),
    });
    await client.command({
      query:
        "CREATE TABLE IF NOT EXISTS ops_server_probe (id UInt64) ENGINE = MergeTree ORDER BY id",
    });
    await client.insert({ table: "ops_server_probe", values: [{ id: 1 }], format: "JSONEachRow" });
    await client.insert({ table: "ops_server_probe", values: [{ id: 2 }], format: "JSONEachRow" });
    await failing(
      client.query({
        query: "SELECT length(range(200000000)) AS n FROM ops_server_probe",
        clickhouse_settings: {
          max_memory_usage: "10000000",
          log_comment: `lwql:project=${project}`,
        },
      }),
    );
    await failing(
      client.query({
        query: "SELECT missing_column FROM ops_server_probe",
        clickhouse_settings: { log_comment: "analytics:timeseries:trace_summaries" },
      }),
    );
    await client.command({ query: "SYSTEM FLUSH LOGS" });
  });

  afterAll(async () => {
    await client?.command({ query: "DROP TABLE IF EXISTS ops_server_probe" });
    await client?.close();
  });

  describe("when statements failed in the app's database", () => {
    /** @scenario "ops reads failed statements from ClickHouse's query log" */
    it("groups them by shape, source and code, naming the LangWatchQL projects", async () => {
      const groups = await repository.findQueryErrors({
        sinceMs: startedAt,
        untilMs: Date.now() + 60_000,
      });

      const lwql = groups.find((row) => row.projectIds.includes(project));
      expect(lwql).toMatchObject({
        source: "lwql",
        code: 241,
        codeName: "MEMORY_LIMIT_EXCEEDED",
        count: 1,
      });
      expect(lwql?.queryShapeId).toMatch(/^\d+$/);
      expect(lwql?.lastAt).toBeGreaterThanOrEqual(startedAt);
      expect(groups.find((row) => row.source === "dashboard")).toMatchObject({
        code: 47,
        codeName: "UNKNOWN_IDENTIFIER",
      });

      const dashboards = await repository.findQueryErrors({
        sinceMs: startedAt,
        untilMs: Date.now() + 60_000,
        source: "dashboard",
      });
      expect(dashboards.map((row) => row.source)).toEqual(["dashboard"]);
    });
  });

  describe("when ops reads the server's health", () => {
    /** @scenario "ops reads ClickHouse's health from its system tables" */
    it("answers nodes, disks, memory and the table's parts", async () => {
      const health = await repository.findHealth({});

      expect(health.nodes).toBeGreaterThanOrEqual(1);
      expect(health.disks.count).toBeGreaterThanOrEqual(1);
      expect(health.disks.freeBytes).toBeGreaterThan(0);
      expect(health.memory.residentBytes).toBeGreaterThan(0);
      expect(health.tables.find((row) => row.table === "ops_server_probe")).toMatchObject({
        activeParts: expect.any(Number),
      });
    });
  });
});
