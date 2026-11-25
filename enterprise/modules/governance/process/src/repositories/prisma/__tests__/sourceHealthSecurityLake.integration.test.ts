/** @vitest-environment node */
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * A Security Lake source's own detail page counts and lists the events it wrote, which carry no
 * trace id, once each, and leaves out trace mirrors of the same source.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { randomUUID } from "node:crypto";

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createActivityMonitorTestService } from "../../../__tests__/testing.ts";

let clickhouse: ClickHouseClient;

function lakeRow({
  tenant,
  source,
  id,
  traceId = "",
  updatedAt,
}: {
  tenant: string;
  source: string;
  id: string;
  traceId?: string;
  updatedAt: number;
}) {
  return {
    TenantId: tenant,
    EventId: id,
    TraceId: traceId,
    SourceId: source,
    SourceType: "security_lake",
    EventTime: new Date(Date.now() - 60_000).toISOString(),
    LastUpdatedAt: new Date(updatedAt).toISOString(),
  };
}

describe("a Security Lake source's own detail page", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-source-health-security-lake",
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

  /** @scenario A Security Lake source's own page counts the events it wrote */
  it("counts and lists each event the source wrote once, without trace mirrors", async () => {
    const tenantId = `health-lake-${randomUUID()}`;
    const now = Date.now();
    await clickhouse.insert({
      table: "governance_ocsf_events",
      format: "JSONEachRow",
      values: [
        lakeRow({ tenant: tenantId, source: "lake", id: "e1", updatedAt: now - 2_000 }),
        lakeRow({ tenant: tenantId, source: "lake", id: "e1", updatedAt: now - 1_000 }),
        lakeRow({ tenant: tenantId, source: "lake", id: "e2", updatedAt: now - 1_000 }),
        lakeRow({
          tenant: tenantId,
          source: "lake",
          id: "mirror",
          traceId: "trace-mirror",
          updatedAt: now,
        }),
        lakeRow({ tenant: tenantId, source: "other", id: "e3", updatedAt: now }),
      ],
      clickhouse_settings: { async_insert: 0 },
    });
    const service = createActivityMonitorTestService({
      prisma: prismaDouble({ project: { findFirst: async () => ({ id: tenantId }) } }),
      clickhouse: { getClient: async () => clickhouse },
      traces: {
        getAttributedTraceRecency: async () => ({ counts: [0, 0, 0], lastOccurredAtMs: 0 }),
        findAttributedTracesBefore: async () => [],
      },
    });

    try {
      const health = await service.sourceHealthMetrics({
        organizationId: "organization",
        sourceId: "lake",
      });
      expect(health).toMatchObject({ events24h: 2, events7d: 2, events30d: 2 });
      const events = await service.eventsForSource({
        organizationId: "organization",
        sourceId: "lake",
      });
      expect(events.map((event) => event.eventId).toSorted()).toEqual(["e1", "e2"]);
    } finally {
      await clickhouse.command({
        query: "ALTER TABLE governance_ocsf_events DELETE WHERE TenantId = {tenant:String}",
        query_params: { tenant: tenantId },
      });
    }
  });
});
