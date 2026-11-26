/**
 * The error filter's numbers against seeded ClickHouse rows. `1=1` is valid SQL that runs
 * fine, so only the counts a caller compares tell a dropped filter from an applied one.
 * @see specs/analytics/filter-value-validation.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper.ts";
import {
  TENANT_ID,
  TRACES,
  TRACES_TOTAL,
  TRACES_WITH_ERROR,
  traceCount,
  traceSummaryRow,
  WINDOW,
} from "./error-series.fixture.ts";
import { ownProjectReaderOver } from "./support/clickhouse-query-client.support.ts";

const SEEDED_TABLES = ["trace_summaries"] as const;
const series = traceCount(0);

describe("the error filter over seeded traces", () => {
  let ch: ClickHouseClient;

  const countTraces = async (filters: Record<string, string[]>): Promise<number> => {
    resetParamCounter();
    const { sql, params } = buildTimeseriesQuery({ ...WINDOW, filters, series: [series] });
    const result = await ownProjectReaderOver({ client: ch, projectId: TENANT_ID }).query<
      Record<string, number | string>
    >({ query: sql, query_params: params, format: "JSONEachRow" });
    const rows = await result.json();
    return Number(rows.find((row) => row.period === "current")?.[series.alias] ?? 0);
  };

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
    await deleteMigratedTenantRows({ client: ch, tenantId: TENANT_ID, tables: SEEDED_TABLES });
    await ch.insert({
      table: "trace_summaries",
      values: TRACES.map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 60_000);

  afterAll(async () => {
    await deleteMigratedTenantRows({ client: ch, tenantId: TENANT_ID, tables: SEEDED_TABLES });
  });

  describe("given traces that contain an error and traces that do not", () => {
    describe("when counted unfiltered, filtered to true and filtered to false", () => {
      /** @scenario "The error filter narrows the count of seeded traces" */
      it("counts each side and the two sides add up to the unfiltered count", async () => {
        const unfiltered = await countTraces({});
        const withError = await countTraces({ "traces.error": ["true"] });
        const withoutError = await countTraces({ "traces.error": ["false"] });

        expect(unfiltered).toBe(TRACES_TOTAL);
        expect(withError).toBe(TRACES_WITH_ERROR);
        expect(withoutError).toBe(TRACES_TOTAL - TRACES_WITH_ERROR);
      });

      it("refuses the option label before any query runs", async () => {
        await expect(countTraces({ "traces.error": ["Traces with error"] })).rejects.toMatchObject({
          code: "analytics_filter_value_unsupported",
        });
      });
    });
  });
});
