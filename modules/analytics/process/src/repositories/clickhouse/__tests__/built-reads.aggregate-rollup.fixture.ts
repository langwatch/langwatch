/**
 * Seed rows and reads for the `trace_analytics_rollup` aggregate-window cases: one row per minute
 * bucket, each cost a distinct power of two so a sum names its buckets (ADR-177).
 */
import { randomUUID } from "node:crypto";

import type { Authorization } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";

import type { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

const RUN = randomUUID();
export const AGGREGATE = `test-agg-rollup-${RUN}`;
export const MEMBER = `test-agg-rollup-member-${RUN}`;
const FOREIGN = `test-agg-rollup-foreign-${RUN}`;
const TABLE = "trace_analytics_rollup";
export const TENANTS = [AGGREGATE, MEMBER, FOREIGN];
export const SEEDED_TABLES = [TABLE];

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
/** The member's grant opens and closes part way through a minute. */
export const GRANT_FROM = at("10:00:30");
export const GRANT_UNTIL = at("12:00:30");

const BUCKETS: { tenantId: string; minute: string; cost: number }[] = [
  { tenantId: MEMBER, minute: "09:00:00", cost: 1 }, // before the window
  { tenantId: MEMBER, minute: "10:00:00", cost: 2 }, // cut by the window's start
  { tenantId: MEMBER, minute: "10:01:00", cost: 4 }, // inside
  { tenantId: MEMBER, minute: "11:59:00", cost: 8 }, // inside, ends before the window's end
  { tenantId: MEMBER, minute: "12:00:00", cost: 16 }, // cut by the window's end
  { tenantId: FOREIGN, minute: "10:30:00", cost: 32 }, // outside the proof
  { tenantId: AGGREGATE, minute: "10:30:00", cost: 64 }, // the aggregate's own
];

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

export const seeds = () => [{ table: TABLE, values: BUCKETS.map(rollupRow) }];

/** The summed cost series over the whole day, as the aggregate's dashboard asks it. */
export function costRead(
  authorization: Authorization,
): Parameters<ClickHouseAnalyticsRepository["runTimeseries"]>[0] {
  const startDate = at("08:00:00");
  return {
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
  };
}
