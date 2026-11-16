/**
 * A real ClickHouse refusal, read through the analytics repository's built read: a statement
 * past its memory cap fails with the handled `query_memory_exceeded`, by the error shape the
 * driver raises.
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { vendorQueryClient, type VendorStatements } from "@langwatch/clickhouse-client/testing";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ANALYTICS_ID_INDEXES } from "../clickhouse.analytics-id-indexes.database.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

/** The suite's connection, every statement capped far below what any read needs. */
function cappedVendor(client: ClickHouseClient): VendorStatements {
  return {
    query: (params) =>
      client.query({
        ...params,
        clickhouse_settings: { ...params.clickhouse_settings, max_memory_usage: "1" },
      }),
    insert: (params) => client.insert(params),
    command: (params) => client.command(params),
  };
}

const TENANT = `test-analytics-memory-cap-${randomUUID()}`;
const START = Temporal.Instant.from("2026-07-01T00:00:00Z");

/** Enough traces that the read must hold rows in memory before it answers. */
const traces = Array.from({ length: 2_000 }, (_, index) => {
  const at = new Date(START.epochMilliseconds + index * 1_000)
    .toISOString()
    .replace("T", " ")
    .replace("Z", "");
  return {
    TenantId: TENANT,
    TraceId: `trace-${index}`,
    Version: "2026-10-05",
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    TraceName: `name-${index % 7}`,
    Labels: [`label-${index % 11}`],
    TotalDurationMs: index,
    SpanCount: 1,
    Attributes: {},
  };
});

describe.skipIf(!enabled)("ClickHouseAnalyticsRepository against ClickHouse", () => {
  let repository: ClickHouseAnalyticsRepository;
  let client: ClickHouseClient;

  beforeAll(async () => {
    ({ client } = await startMigratedClickHouse());
    await client.insert({
      table: "trace_analytics",
      values: traces,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    repository = ClickHouseAnalyticsRepository.create({
      clickhouse: vendorQueryClient({
        vendor: cappedVendor(client),
        indexes: ANALYTICS_ID_INDEXES,
      }),
    });
  });

  afterAll(async () => {
    await deleteMigratedTenantRows({ client, tenantId: TENANT, tables: ["trace_analytics"] });
  });

  describe("when a series read runs past its memory cap", () => {
    it("fails with query_memory_exceeded, status 422 and a customer fault", async () => {
      const startDate = START;

      const read = repository.runTimeseries({
        table: "trace_analytics",
        authorization: analyticsProof({ projectId: TENANT }),
        input: {
          projectId: TENANT,
          startDate: startDate.epochMilliseconds,
          endDate: startDate.epochMilliseconds + 3_600_000,
          filters: {},
          series: [{ metric: "performance.completion_time", aggregation: "p99" }],
          groupBy: "metadata.labels",
          timeScale: "full",
          timeZone: "UTC",
        },
        startDate,
        endDate: startDate.add({ hours: 1 }),
        previousPeriodStartDate: startDate.subtract({ hours: 1 }),
        adjustedTimeScale: "full",
        maxResultRows: undefined,
      });

      await expect(read).rejects.toMatchObject({
        code: "query_memory_exceeded",
        httpStatus: 422,
        fault: "customer",
      });
    });
  });
});
