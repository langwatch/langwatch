/** @vitest-environment node */

// Ported from main's sourceHealthHistory.integration.test.ts: a historical import
// counts nothing in the recent windows yet still reports its newest event.
import { randomUUID } from "node:crypto";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/test-harness/clickhouse";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaActivityMonitorRepository } from "../prisma.ingestion-source-activity.repository.ts";

const DAY_MS = 86_400_000;

let clickhouse: ClickHouseClient;

/** ISO with its zone, so the server's own time zone cannot shift the row. */
function timestamp(ms: number): string {
  return new Date(ms).toISOString();
}

function rowFor({
  kind,
  tenant,
  source,
  id,
  time,
}: {
  kind: "pulled" | "traced" | "logged";
  tenant: string;
  source: string;
  id: string;
  time: number;
}) {
  const base = { TenantId: tenant, TraceId: `pull:${id}` };
  if (kind === "pulled") {
    return { ...base, SourceId: source, EventId: id, EventTime: timestamp(time) };
  }
  const shared = {
    ...base,
    ProjectionId: id,
    Attributes: {
      "langwatch.origin.kind": "ingestion_source",
      "langwatch.ingestion_source.id": source,
    },
    CreatedAt: timestamp(time),
    UpdatedAt: timestamp(time),
  };
  return kind === "traced"
    ? { ...shared, OccurredAt: timestamp(time), Version: "v1" }
    : { ...shared, TimeUnixMs: timestamp(time) };
}

describe("source health during a historical provider import", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-source-health",
      names: ["health"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the health suite");
    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: {
              buildTime: false,
              skipped: false,
              sharedUrl: endpoint.url,
              privateEndpoints: [],
              settings: {
                coldStorageEnabled: false,
                hotDayOverrides: {},
                childEnvironment: { PATH: process.env.PATH, HOME: process.env.HOME },
              },
            },
          }).execute();
        } finally {
          if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
        }
      },
    });
    clickhouse = createClient({
      url: endpoint.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
  }, 600_000);

  afterAll(async () => {
    await clickhouse?.close();
  });

  it.each([
    ["pulled", "governance_ocsf_events"],
    ["traced", "trace_summaries"],
    ["logged", "stored_log_records"],
  ] as const)(
    "keeps %s counts at zero while reporting the newest historical event, scoped to this source and tenant",
    async (kind, table) => {
      const tenantId = `health-history-${randomUUID()}`;
      const old = Date.now() - 90 * DAY_MS;
      await clickhouse.insert({
        table,
        format: "JSONEachRow",
        values: [
          rowFor({ kind, tenant: tenantId, source: "source", id: "old", time: old }),
          rowFor({ kind, tenant: tenantId, source: "other", id: "other", time: Date.now() }),
          rowFor({
            kind,
            tenant: `${tenantId}-other`,
            source: "source",
            id: "foreign",
            time: Date.now(),
          }),
        ],
        clickhouse_settings: { async_insert: 0 },
      });
      const repository = PrismaActivityMonitorRepository.create({
        prisma: prismaDouble({ project: { findFirst: async () => ({ id: tenantId }) } }),
        clickhouse: { getClient: async () => clickhouse },
      });

      try {
        const health = await repository.sourceHealthMetrics({
          organizationId: "organization",
          sourceId: "source",
        });
        expect(health).toMatchObject({ events24h: 0, events7d: 0, events30d: 0 });
        expect(health.lastSuccessIso).toBe(new Date(old).toISOString());
      } finally {
        await clickhouse.command({
          query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({tenants:Array(String)})`,
          query_params: { tenants: [tenantId, `${tenantId}-other`] },
        });
      }
    },
  );
});
