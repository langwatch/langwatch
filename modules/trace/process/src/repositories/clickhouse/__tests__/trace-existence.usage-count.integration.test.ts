/** @vitest-environment node */

/**
 * The usage report's trace and span figures, read from what the install stores: lifetime and
 * over a window, one install at a time.
 * @see specs/self-hosting/connected-services/usage-report.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseTraceExistenceRepository } from "../trace-existence.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const run = nanoid(8);
const install = `usage-count-install-${run}`;
const otherInstall = `usage-count-other-${run}`;
const now = Date.now();

let ch: ClickHouseClient;
let repo: ClickHouseTraceExistenceRepository;

const clock = (ms: number): string => new Date(ms).toISOString().replace("T", " ").replace("Z", "");

/** One trace holding one span, started `daysAgo` days before now. */
async function store({ tenantId, daysAgo }: { tenantId: string; daysAgo: number }) {
  const at = clock(now - daysAgo * DAY_MS);
  const traceId = `trace-${nanoid()}`;
  const insert = (table: string, row: Record<string, unknown>) =>
    ch.insert({
      table,
      values: [row],
      format: "JSONEachRow",
      clickhouse_settings: {
        async_insert: 0,
        wait_for_async_insert: 0,
        date_time_input_format: "best_effort",
      },
    });
  await insert("trace_summaries", {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    TotalDurationMs: 100,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TokensEstimated: false,
  });
  await insert("stored_spans", {
    ProjectionId: `span-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: nanoid(16),
    Sampled: 1,
    StartTime: at,
    EndTime: at,
    DurationMs: 100,
    SpanName: "usage-count",
    SpanKind: 1,
    ServiceName: "usage-count",
  });
}

describe.skipIf(!testClickHouseConfigured())(
  "the trace and span figures of the usage report (real ClickHouse)",
  () => {
    beforeAll(async () => {
      ch = await startMigratedTraceClickHouse();
      repo = ClickHouseTraceExistenceRepository.create({ resolveClient: async () => ch });
      for (const daysAgo of [3, 20, 40]) await store({ tenantId: install, daysAgo });
      await store({ tenantId: otherInstall, daysAgo: 3 });
    }, 120_000);

    afterAll(async () => {
      if (!ch) return;
      for (const table of ["trace_summaries", "stored_spans"]) {
        await ch.exec({
          query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({install:String}, {other:String})`,
          query_params: { install, other: otherInstall },
        });
      }
    });

    describe("given spans stored three, twenty and forty days ago, and another install's spans", () => {
      describe("when spans are counted", () => {
        /** @scenario Spans are counted from what the install stores, lifetime and over two windows */
        it("counts this install's spans lifetime and inside each window, and none of the other's", async () => {
          const projectIds = [install];

          const lifetime = await repo.countUsage({ projectIds });
          const sevenDays = await repo.countUsage({ projectIds, since: now - 7 * DAY_MS });
          const twentyEightDays = await repo.countUsage({ projectIds, since: now - 28 * DAY_MS });

          expect(lifetime).toEqual({ traces: 3, spans: 3 });
          expect(sevenDays).toEqual({ traces: 1, spans: 1 });
          expect(twentyEightDays).toEqual({ traces: 2, spans: 2 });
        });
      });
    });
  },
);
