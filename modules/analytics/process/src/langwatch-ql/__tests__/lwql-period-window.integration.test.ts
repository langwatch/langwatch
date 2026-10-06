/**
 * The window a surface sends, spelled by the time-window service and read by a real ClickHouse
 * on the shipped migrations: a row at a known instant is inside the window that holds it and
 * outside every window that does not, and the end instant is excluded.
 * @see specs/lwql/workbench.feature
 * @vitest-environment node
 */
import { randomUUID } from "node:crypto";

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../__tests__/migrated-clickhouse.harness.ts";
import {
  traceSummaryRow,
  TRACES,
} from "../../repositories/clickhouse/__tests__/error-series.fixture.ts";
import type { LangWatchQLParameter } from "../../rules/langwatch-ql-validation-shape.rules.ts";
import { LangWatchQLTimeWindowService } from "../../services/langwatch-ql-time-window.service.ts";

const timeWindows = LangWatchQLTimeWindowService.create();
const TENANT_ID = `lwql-window-${randomUUID()}`;
const RECORDED_AT = "2026-02-20T12:00:00.000Z";
const HOUR_MS = 3_600_000;
const DECLARED: LangWatchQLParameter[] = [
  { name: "dashboard_context_period_start", type: "DateTime" },
  { name: "dashboard_context_period_end", type: "DateTime" },
  { name: "tenant", type: "String" },
];
const STATEMENT =
  "SELECT count() AS n FROM trace_summaries WHERE TenantId = {tenant:String} " +
  "AND OccurredAt >= {dashboard_context_period_start:DateTime} " +
  "AND OccurredAt < {dashboard_context_period_end:DateTime}";

const at = (offsetMs: number) => new Date(Date.parse(RECORDED_AT) + offsetMs).toISOString();

describe("given a row recorded at a known instant", () => {
  let ch: ClickHouseClient;

  /** The statement run for one window, its parameters bound by the time-window service. */
  async function rowsInWindow(timeWindow: { start: string; end: string }): Promise<number> {
    const { parameters } = timeWindows.resolveTimeWindow({
      declared: DECLARED,
      parameters: { tenant: TENANT_ID },
      timeWindow,
    });
    const result = await ch.query({
      query: STATEMENT,
      query_params: parameters,
      format: "JSONEachRow",
    });
    const [row] = await result.json<{ n: string }>();

    return Number(row?.n);
  }

  beforeAll(async () => {
    ch = (await startMigratedClickHouse()).client;
    const [trace] = TRACES;
    if (!trace) throw new Error("the trace fixture is empty");
    await ch.insert({
      table: "trace_summaries",
      values: [
        {
          ...traceSummaryRow(trace),
          ProjectionId: `proj-${TENANT_ID}`,
          TenantId: TENANT_ID,
          TraceId: `${TENANT_ID}-trace`,
          OccurredAt: new Date(RECORDED_AT),
        },
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 60_000);

  afterAll(async () => {
    await deleteMigratedTenantRows({
      client: ch,
      tenantId: TENANT_ID,
      tables: ["trace_summaries"],
    });
  });

  describe("when a period-aware statement runs for a window containing that instant", () => {
    /** @scenario "The window the surface sends is the window the database reads" */
    it("returns the row, and returns none for a window that does not contain it", async () => {
      expect(await rowsInWindow({ start: at(-HOUR_MS), end: at(HOUR_MS) })).toBe(1);
      expect(await rowsInWindow({ start: at(HOUR_MS), end: at(2 * HOUR_MS) })).toBe(0);
      expect(await rowsInWindow({ start: at(-2 * HOUR_MS), end: at(-HOUR_MS) })).toBe(0);
    });
  });

  describe("when the window edge is exactly that instant", () => {
    /** @scenario "The period is half-open, so the start instant is included and the end instant is not" */
    it("includes the row when the window starts there and excludes it when the window ends there", async () => {
      expect(await rowsInWindow({ start: at(0), end: at(HOUR_MS) })).toBe(1);
      expect(await rowsInWindow({ start: at(-HOUR_MS), end: at(0) })).toBe(0);
    });
  });
});
