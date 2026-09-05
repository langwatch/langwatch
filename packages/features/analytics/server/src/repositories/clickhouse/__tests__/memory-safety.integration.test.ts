/**
 * Memory-budgeted execution of the generated analytics queries.
 *
 * Every case runs the SQL the builder emits against ClickHouse carrying the
 * *shipped* migrations, so a query that names a column the schema does not
 * have fails here rather than in production. Three properties are asserted
 * separately because they fail separately: the SQL is valid, it stays inside a
 * hard memory ceiling on deliberately wide rows, and it returns the number the
 * seed implies.
 *
 * The wide-attribute tenant is the whole memory argument. A metric that reads
 * `SpanAttributes` when it only needs `trace_summaries` columns is invisible
 * against narrow rows and an out-of-memory failure against real ones.
 *
 * @see specs/analytics/clickhouse-memory-safety.feature
 *
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsSeries } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteMigratedTenantRows,
  releaseMigratedCaches,
  seedSpans,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper";

const TENANT_ID = "memory-safety-test";
const WIDE_TENANT_ID = "memory-safety-wide-test";
const WIDE_COLUMN_TENANT_ID = "memory-safety-wide-column-test";
const SEEDED_TABLES = ["trace_summaries", "stored_spans"] as const;

/** 50 MB. The ceiling a wide-attribute read blows through. */
const MEMORY_BUDGET = "50000000";
/**
 * The wide tenants hold 80 KB of `SpanAttributes` per span, so a thousand of
 * them is 80 MB and two thousand is 160 MB — several times the budget above,
 * which is what makes an unpruned read fail here. The width is spread over
 * more spans rather than more bytes per span because the test server runs
 * under its own 1 GiB ceiling and refuses the seed long before the assertion
 * if one insert block is wide enough to matter.
 */
const TIME_BUDGET_MS = 5_000;

/**
 * One entry per metric prefix the translator has a distinct code path for.
 * Metrics that need a key supply one, so the case exercises the keyed shape
 * rather than the builder's fallback.
 */
const REPRESENTATIVE_METRICS: Array<{ label: string; series: AnalyticsSeries[] }> = [
  {
    label: "metadata.trace_id (cardinality)",
    series: [{ metric: "metadata.trace_id", aggregation: "cardinality" }],
  },
  {
    label: "metadata.user_id (cardinality)",
    series: [{ metric: "metadata.user_id", aggregation: "cardinality" }],
  },
  {
    label: "metadata.thread_id (cardinality)",
    series: [{ metric: "metadata.thread_id", aggregation: "cardinality" }],
  },
  {
    label: "metadata.span_type (cardinality)",
    series: [{ metric: "metadata.span_type", aggregation: "cardinality" }],
  },
  {
    label: "performance.completion_time (avg)",
    series: [{ metric: "performance.completion_time", aggregation: "avg" }],
  },
  {
    label: "performance.total_cost (sum)",
    series: [{ metric: "performance.total_cost", aggregation: "sum" }],
  },
  {
    label: "performance.prompt_tokens (sum)",
    series: [{ metric: "performance.prompt_tokens", aggregation: "sum" }],
  },
  {
    label: "performance.completion_tokens (sum)",
    series: [{ metric: "performance.completion_tokens", aggregation: "sum" }],
  },
  {
    label: "performance.total_tokens (sum)",
    series: [{ metric: "performance.total_tokens", aggregation: "sum" }],
  },
  {
    label: "performance.first_token (avg)",
    series: [{ metric: "performance.first_token", aggregation: "avg" }],
  },
  {
    label: "performance.tokens_per_second (avg)",
    series: [{ metric: "performance.tokens_per_second", aggregation: "avg" }],
  },
  {
    label: "sentiment.thumbs_up_down (avg)",
    series: [{ metric: "sentiment.thumbs_up_down", aggregation: "avg" }],
  },
  {
    label: "events.event_type (cardinality)",
    series: [{ metric: "events.event_type", aggregation: "cardinality", key: "test_event" }],
  },
  {
    label: "events.event_score (avg)",
    series: [
      { metric: "events.event_score", aggregation: "avg", key: "test_event", subkey: "vote" },
    ],
  },
  {
    label: "evaluations.evaluation_score (avg)",
    series: [{ metric: "evaluations.evaluation_score", aggregation: "avg", key: "eval-1" }],
  },
  {
    label: "evaluations.evaluation_pass_rate (avg)",
    series: [{ metric: "evaluations.evaluation_pass_rate", aggregation: "avg", key: "eval-1" }],
  },
  {
    label: "evaluations.evaluation_runs (cardinality)",
    series: [{ metric: "evaluations.evaluation_runs", aggregation: "cardinality" }],
  },
  {
    label: "threads.average_duration_per_thread (avg)",
    series: [{ metric: "threads.average_duration_per_thread", aggregation: "avg" }],
  },
];

const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date("2020-01-01T00:00:00Z"),
  endDate: new Date("2030-01-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2019-01-01T00:00:00Z"),
  timeScale: 60 as number | "full",
};

function buildQuery(series: AnalyticsSeries[], projectId = TENANT_ID) {
  resetParamCounter();
  return buildTimeseriesQuery({ ...baseInput, projectId, series });
}

/** Runs the query and drains it, failing the case only on a memory refusal. */
async function runWithinBudget({
  client,
  label,
  sql,
  params,
}: {
  client: ClickHouseClient;
  label: string;
  sql: string;
  params: Record<string, unknown>;
}): Promise<void> {
  try {
    const result = await client.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
      clickhouse_settings: { max_memory_usage: MEMORY_BUDGET },
    });
    await result.json();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("MEMORY_LIMIT_EXCEEDED")) {
      expect.fail(`Query "${label}" exceeded the 50MB memory budget: ${message}`);
    }
    throw error;
  }
}

function currentPeriodValue(rows: Array<Record<string, unknown>>): number {
  const currentRow = rows.find((row) => row.period === "current");
  expect(currentRow).toBeDefined();
  const metricKey = Object.keys(currentRow ?? {}).find((key) => key !== "period" && key !== "date");
  expect(metricKey).toBeDefined();
  return Number((currentRow ?? {})[metricKey ?? ""]);
}

describe("memory safety of the generated analytics queries", () => {
  let client: ClickHouseClient;

  beforeAll(async () => {
    client = (await startMigratedClickHouse()).client;
    await seedSpans(client, {
      tenantId: TENANT_ID,
      count: 10_000,
      attributeKeys: 50,
      attributeValueSize: 100,
      traceCount: 1000,
      knownCost: 0.05,
    });
  }, 300_000);

  afterAll(async () => {
    await deleteMigratedTenantRows({ client, tenantId: TENANT_ID, tables: SEEDED_TABLES });
  });

  describe("when executing generated analytics queries against ClickHouse", () => {
    for (const { label, series } of REPRESENTATIVE_METRICS) {
      /** @scenario All generated analytics queries are valid ClickHouse SQL */
      it(`executes valid SQL for ${label}`, async () => {
        const { sql, params } = buildQuery(series);
        const result = await client.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });
        await result.json();
      });
    }
  });

  describe("when executing analytics queries with a tight memory budget", () => {
    beforeAll(async () => {
      await releaseMigratedCaches(client);
      await seedSpans(client, {
        tenantId: WIDE_TENANT_ID,
        count: 2_000,
        attributeKeys: 20,
        attributeValueSize: 4096,
        traceCount: 200,
      });
    }, 300_000);

    afterAll(async () => {
      await deleteMigratedTenantRows({
        client,
        tenantId: WIDE_TENANT_ID,
        tables: SEEDED_TABLES,
      });
    });

    for (const { label, series } of REPRESENTATIVE_METRICS) {
      /** @scenario Analytics queries complete within a tight memory budget */
      it(`completes ${label} within the 50MB memory budget`, async () => {
        const { sql, params } = buildQuery(series, WIDE_TENANT_ID);
        await runWithinBudget({ client, label, sql, params });
      });
    }
  });

  describe("when checking query execution time on seeded data", () => {
    for (const { label, series } of REPRESENTATIVE_METRICS) {
      /** @scenario Analytics queries complete within time budget on seeded data */
      it(`completes ${label} within ${TIME_BUDGET_MS}ms`, async () => {
        const { sql, params } = buildQuery(series);
        const start = performance.now();
        const result = await client.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });
        await result.json();
        expect(performance.now() - start).toBeLessThan(TIME_BUDGET_MS);
      });
    }
  });

  describe("when proving column pruning prevents an out-of-memory read of wide SpanAttributes", () => {
    beforeAll(async () => {
      await releaseMigratedCaches(client);
      await seedSpans(client, {
        tenantId: WIDE_COLUMN_TENANT_ID,
        count: 1_000,
        attributeKeys: 20,
        attributeValueSize: 4096,
        traceCount: 100,
      });
    }, 300_000);

    afterAll(async () => {
      await deleteMigratedTenantRows({
        client,
        tenantId: WIDE_COLUMN_TENANT_ID,
        tables: SEEDED_TABLES,
      });
    });

    it("generates SQL that does not name SpanAttributes for total_cost", () => {
      const { sql } = buildQuery(
        [{ metric: "performance.total_cost", aggregation: "sum" }],
        WIDE_COLUMN_TENANT_ID,
      );
      expect(sql).not.toContain("SpanAttributes");
    });

    /** @scenario Analytics queries complete within a tight memory budget */
    it("completes the total_cost query within 50MB on wide-attribute data", async () => {
      const { sql, params } = buildQuery(
        [{ metric: "performance.total_cost", aggregation: "sum" }],
        WIDE_COLUMN_TENANT_ID,
      );
      await runWithinBudget({ client, label: "performance.total_cost", sql, params });
    });

    it("completes the tokens_per_second query within 50MB on wide-attribute data", async () => {
      const { sql, params } = buildQuery(
        [{ metric: "performance.tokens_per_second", aggregation: "avg" }],
        WIDE_COLUMN_TENANT_ID,
      );
      await runWithinBudget({ client, label: "performance.tokens_per_second", sql, params });
    });
  });

  describe("when reading tokens_per_second", () => {
    it("names TokensPerSecond on trace_summaries rather than stored_spans", () => {
      const { sql } = buildQuery([{ metric: "performance.tokens_per_second", aggregation: "avg" }]);
      expect(sql).not.toContain("SpanAttributes");
      expect(sql).not.toMatch(/\bstored_spans\b/);
      expect(sql).toContain("TokensPerSecond");
    });

    it("wraps the percentile in the tdigest family", () => {
      const { sql } = buildQuery([{ metric: "performance.tokens_per_second", aggregation: "p95" }]);
      expect(sql).not.toContain("SpanAttributes");
      expect(sql).toContain("TokensPerSecond");
      expect(sql).toContain("quantileTDigest(");
    });
  });

  describe("when verifying query results on seeded data", () => {
    function buildFullPeriodQuery(series: AnalyticsSeries[]) {
      resetParamCounter();
      return buildTimeseriesQuery({
        ...baseInput,
        projectId: TENANT_ID,
        timeScale: "full",
        series,
      });
    }

    async function readCurrentPeriodValue(series: AnalyticsSeries[]): Promise<number> {
      const { sql, params } = buildFullPeriodQuery(series);
      const result = await client.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
      });
      return currentPeriodValue(await result.json<Record<string, unknown>>());
    }

    /** @scenario Analytics query results are correct on seeded data */
    it("returns the seeded trace count for a cardinality of metadata.trace_id", async () => {
      expect(
        await readCurrentPeriodValue([{ metric: "metadata.trace_id", aggregation: "cardinality" }]),
      ).toBe(1000);
    });

    it("returns the seeded total cost", async () => {
      expect(
        await readCurrentPeriodValue([{ metric: "performance.total_cost", aggregation: "sum" }]),
      ).toBeCloseTo(50, 1);
    });

    it("returns the seeded average tokens per second", async () => {
      expect(
        await readCurrentPeriodValue([
          { metric: "performance.tokens_per_second", aggregation: "avg" },
        ]),
      ).toBeCloseTo(100, 0);
    });
  });
});
