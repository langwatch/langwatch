import { randomUUID } from "node:crypto";

/**
 * An aggregate's series on `trace_analytics_rollup` reads its member inside the grant's window,
 * whole minute buckets only, and never a project outside the proof (ADR-177).
 * @see specs/governance/aggregate-project.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsTimeseriesResult } from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

const RUN = randomUUID();
const AGGREGATE = `test-agg-rollup-${RUN}`;
const MEMBER = `test-agg-rollup-member-${RUN}`;
const FOREIGN = `test-agg-rollup-foreign-${RUN}`;
const TABLE = "trace_analytics_rollup";

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
// The member's grant opens and closes part way through a minute.
const GRANT_FROM = at("10:00:30");
const GRANT_UNTIL = at("12:00:30");

/** One rollup row per bucket, each a distinct power of two so a sum names its buckets. */
const BUCKETS: { tenantId: string; minute: string; cost: number }[] = [
  { tenantId: MEMBER, minute: "09:00:00", cost: 1 }, // before the window
  { tenantId: MEMBER, minute: "10:00:00", cost: 2 }, // cut by the window's start
  { tenantId: MEMBER, minute: "10:01:00", cost: 4 }, // inside
  { tenantId: MEMBER, minute: "11:59:00", cost: 8 }, // inside, ends before the window's end
  { tenantId: MEMBER, minute: "12:00:00", cost: 16 }, // cut by the window's end
  { tenantId: FOREIGN, minute: "10:30:00", cost: 32 }, // outside the proof
  { tenantId: AGGREGATE, minute: "10:30:00", cost: 64 }, // the aggregate's own
];

let client: ClickHouseClient;
let repository: ClickHouseAnalyticsRepository;

function rollupRow({ tenantId, minute, cost }: (typeof BUCKETS)[number]) {
  return {
    TenantId: tenantId,
    BucketStart: `${DAY} ${minute}.000`,
    Model: "",
    SpanType: "",
    SpanCount: 1,
    TraceCount: 1,
    ErrorCount: 0,
    CostSum: cost,
    NonBilledCostSum: 0,
    DurationSum: 0,
    PromptTokensSum: 0,
    CompletionTokensSum: 0,
    CacheReadTokensSum: 0,
    CacheWriteTokensSum: 0,
    ReasoningTokensSum: 0,
  };
}

function totalCost(result: AnalyticsTimeseriesResult): number {
  return result.currentPeriod.reduce(
    (sum, bucket) => sum + Number(bucket["0/performance.total_cost/sum"] ?? 0),
    0,
  );
}

function readCost(authorization: Authorization): Promise<AnalyticsTimeseriesResult> {
  const startDate = at("08:00:00");
  return repository.runTimeseries({
    table: TABLE,
    authorization,
    input: {
      projectId: AGGREGATE,
      startDate: startDate.epochMilliseconds,
      endDate: at("14:00:00").epochMilliseconds,
      filters: {},
      series: [{ metric: "performance.total_cost", aggregation: "sum" }],
      timeScale: "full",
      timeZone: "UTC",
    },
    startDate,
    endDate: at("14:00:00"),
    previousPeriodStartDate: startDate,
    adjustedTimeScale: "full",
    maxResultRows: undefined,
  });
}

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  repository = ClickHouseAnalyticsRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  await client.insert({
    table: TABLE,
    values: BUCKETS.map(rollupRow),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
});

afterAll(async () => {
  for (const tenantId of [AGGREGATE, MEMBER, FOREIGN]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: [TABLE] });
  }
});

describe("trace analytics rollup read under an aggregate's proof", () => {
  describe("given a member shared from part way through one minute to part way through another", () => {
    /** @scenario "The aggregate's analytics rollup counts members inside their windows" */
    it("counts the member's whole buckets inside the window and the aggregate's own, nothing else", async () => {
      const result = await readCost(
        analyticsProof({
          projectId: AGGREGATE,
          shared: [
            {
              projectId: MEMBER,
              from: GRANT_FROM.epochMilliseconds,
              until: GRANT_UNTIL.epochMilliseconds,
            },
          ],
        }),
      );

      expect(totalCost(result)).toBe(4 + 8 + 64);
    });
  });

  describe("given a member whose grant is still open", () => {
    it("counts every member bucket from the window's start on", async () => {
      const result = await readCost(
        analyticsProof({
          projectId: AGGREGATE,
          shared: [{ projectId: MEMBER, from: GRANT_FROM.epochMilliseconds }],
        }),
      );

      expect(totalCost(result)).toBe(4 + 8 + 16 + 64);
    });
  });

  describe("given a plain project's proof", () => {
    it("counts its own buckets alone, as before", async () => {
      const result = await readCost(analyticsProof({ projectId: AGGREGATE }));

      expect(totalCost(result)).toBe(64);
    });
  });
});
