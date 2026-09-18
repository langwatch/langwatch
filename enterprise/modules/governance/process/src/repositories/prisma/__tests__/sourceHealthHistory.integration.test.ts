/** @vitest-environment node */
import { randomUUID } from "node:crypto";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { migrateTestClickHouseOnce, startTestClickHouseEndpoints } from "@langwatch/test-harness/clickhouse";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActivityMonitorHealthClickHouseRepository } from "../activityMonitor.health.clickhouse.repository";

let ch: ClickHouseClient;

describe("source health during a historical provider import", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-source-health-history",
      names: ["health"],
    });
    if (!endpoint)
      throw new Error("No ClickHouse endpoint was provisioned for the source-health-history suite");

    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        // CLICKHOUSE_CLUSTER switches every engine to its Replicated form,
        // which needs a Keeper no test server has.
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: {
              buildTime: false,
              skipped: false,
              sharedUrl: endpoint.url,
              privateEndpoints: [],
            },
          }).execute();
        } finally {
          if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
        }
      },
    });

    ch = createClient({
      url: endpoint.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  });
  afterAll(async () => {
    await ch?.close();
  });
  it.each(["pulled", "traced", "logged"] as const)(
    "keeps %s counts at zero while reporting the newest historical event, scoped to this source and tenant",
    async (kind) => {
      const tenantId = `health-history-${randomUUID()}`;
      const old = Date.now() - 90 * 86_400_000;
      const timestamp = (ms: number) =>
        new Date(ms).toISOString().replace("T", " ").replace("Z", "");
      const table = {
        pulled: "governance_ocsf_events",
        traced: "trace_summaries",
        logged: "stored_log_records",
      }[kind];
      const records = [
        { tenant: tenantId, source: "source", id: "old", time: old },
        { tenant: tenantId, source: "other", id: "other", time: Date.now() },
        {
          tenant: `${tenantId}-other`,
          source: "source",
          id: "foreign",
          time: Date.now(),
        },
      ];
      const values = records.map(({ tenant, source, id, time }) => {
        const base = { TenantId: tenant, TraceId: `pull:${id}` };
        if (kind === "pulled")
          return {
            ...base,
            SourceId: source,
            EventId: id,
            EventTime: timestamp(time),
          };
        const attrs = {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.ingestion_source.id": source,
        };
        return {
          ...base,
          ProjectionId: id,
          Attributes: attrs,
          CreatedAt: timestamp(time),
          UpdatedAt: timestamp(time),
          ...(kind === "traced"
            ? { OccurredAt: timestamp(time), Version: "v1" }
            : { TimeUnixMs: timestamp(time) }),
        };
      });
      await ch.insert({
        table,
        format: "JSONEachRow",
        values,
        clickhouse_settings: { async_insert: 0 },
      });
      const repository = new ActivityMonitorHealthClickHouseRepository(async () => ch);
      const methods = {
        pulled: "findPulledEventWindowCounts",
        traced: "findTracedEventWindowCounts",
        logged: "findLoggedEventWindowCounts",
      } as const;
      try {
        const row = await repository[methods[kind]]({
          tenantId,
          sourceId: "source",
          since24h: Date.now() - 86_400_000,
          since7d: Date.now() - 7 * 86_400_000,
          since30d: Date.now() - 30 * 86_400_000,
        });
        expect(row).toMatchObject({ c24: 0, c7: 0, c30: 0 });
        expect(Number(row?.lastMs)).toBe(old);
      } finally {
        await ch.command({
          query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({tenants:Array(String)})`,
          query_params: { tenants: [tenantId, `${tenantId}-other`] },
        });
      }
    },
  );
});
