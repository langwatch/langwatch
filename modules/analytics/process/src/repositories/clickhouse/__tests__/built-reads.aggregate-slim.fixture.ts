/**
 * Seed rows and reads for the slim `trace_analytics` aggregate-window cases: one trace per row,
 * each cost a distinct power of two so a sum names its traces (ADR-177).
 */
import { randomUUID } from "node:crypto";

import type { Authorization } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";

import type { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";

const RUN = randomUUID();
export const AGGREGATE = `test-agg-slim-${RUN}`;
export const MEMBER = `test-agg-slim-member-${RUN}`;
const FOREIGN = `test-agg-slim-foreign-${RUN}`;
const TABLE = "trace_analytics";
export const TENANTS = [AGGREGATE, MEMBER, FOREIGN];
export const SEEDED_TABLES = [TABLE];

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
export const GRANT_FROM = at("10:00:00");
export const GRANT_UNTIL = at("12:00:00");

const TRACES: { tenantId: string; time: string; cost: number }[] = [
  { tenantId: MEMBER, time: "09:30:00", cost: 1 }, // before the window
  { tenantId: MEMBER, time: "10:15:00", cost: 2 }, // inside
  { tenantId: MEMBER, time: "11:45:00", cost: 4 }, // inside
  { tenantId: MEMBER, time: "12:30:00", cost: 8 }, // after the window
  { tenantId: FOREIGN, time: "10:30:00", cost: 16 }, // outside the proof
  { tenantId: AGGREGATE, time: "10:30:00", cost: 32 }, // the aggregate's own
];

function traceAnalyticsRow({ tenantId, time, cost }: (typeof TRACES)[number], index: number) {
  const occurredAt = new Date(at(time).epochMilliseconds);
  return {
    TenantId: tenantId,
    TraceId: `trace-${RUN}-${index}`,
    Version: "2026-10-05",
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    TraceName: "aggregate slim trace",
    Origin: "",
    Models: [],
    Labels: [],
    TotalCost: cost,
    TotalDurationMs: 100,
    HasError: false,
    SpanCount: 1,
    EarliestSpanStartMs: occurredAt.getTime(),
    Attributes: {},
  };
}

export const seeds = () => [{ table: TABLE, values: TRACES.map(traceAnalyticsRow) }];

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
