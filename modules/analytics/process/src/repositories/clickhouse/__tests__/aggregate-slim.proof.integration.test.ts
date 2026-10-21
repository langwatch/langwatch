import { randomUUID } from "node:crypto";

/**
 * An aggregate's series on the slim `trace_analytics` table reads its member inside the grant's
 * window, by when each trace occurred, and never a project outside the proof (ADR-177).
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
const AGGREGATE = `test-agg-slim-${RUN}`;
const MEMBER = `test-agg-slim-member-${RUN}`;
const FOREIGN = `test-agg-slim-foreign-${RUN}`;
const TABLE = "trace_analytics";

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const GRANT_FROM = at("10:00:00");
const GRANT_UNTIL = at("12:00:00");

/** One trace per row, each a distinct power of two so a sum names its traces. */
const TRACES: { tenantId: string; time: string; cost: number }[] = [
  { tenantId: MEMBER, time: "09:30:00", cost: 1 }, // before the window
  { tenantId: MEMBER, time: "10:15:00", cost: 2 }, // inside
  { tenantId: MEMBER, time: "11:45:00", cost: 4 }, // inside
  { tenantId: MEMBER, time: "12:30:00", cost: 8 }, // after the window
  { tenantId: FOREIGN, time: "10:30:00", cost: 16 }, // outside the proof
  { tenantId: AGGREGATE, time: "10:30:00", cost: 32 }, // the aggregate's own
];

let client: ClickHouseClient;
let repository: ClickHouseAnalyticsRepository;

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
    values: TRACES.map(traceAnalyticsRow),
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
});

afterAll(async () => {
  for (const tenantId of [AGGREGATE, MEMBER, FOREIGN]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: [TABLE] });
  }
});

describe("slim trace analytics read under an aggregate's proof", () => {
  describe("given a member shared for a closed window", () => {
    /** @scenario "The aggregate's slim analytics counts members inside their windows" */
    it("counts the member's traces inside the window and the aggregate's own, nothing else", async () => {
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

      expect(totalCost(result)).toBe(2 + 4 + 32);
    });
  });

  describe("given a member whose grant is still open", () => {
    it("counts every member trace from the window's start on", async () => {
      const result = await readCost(
        analyticsProof({
          projectId: AGGREGATE,
          shared: [{ projectId: MEMBER, from: GRANT_FROM.epochMilliseconds }],
        }),
      );

      expect(totalCost(result)).toBe(2 + 4 + 8 + 32);
    });
  });

  describe("given a plain project's proof", () => {
    it("counts its own traces alone, as before", async () => {
      const result = await readCost(analyticsProof({ projectId: AGGREGATE }));

      expect(totalCost(result)).toBe(32);
    });
  });
});
