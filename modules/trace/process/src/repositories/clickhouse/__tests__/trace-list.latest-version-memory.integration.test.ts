/**
 * The latest-version dedup every trace_summaries read shares, run under a memory cap on a window
 * of 600,000 traces with 100,000 superseded versions.
 * @see specs/traces-v2/latest-version-dedup.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { latestTraceVersionOnly } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();
const TENANT = `project_${nanoid(21).replace(/[^A-Za-z0-9]/g, "x")}`;
const TRACE_COUNT = 600_000;
const SUPERSEDED = 100_000;
const SEED_SLICE = 200_000;
const BASE = "toDateTime64('2026-10-01 00:00:00', 3)";
const WINDOW = `TenantId = {tenant:String} AND OccurredAt >= ${BASE} - INTERVAL 1 DAY
  AND OccurredAt <= ${BASE} + INTERVAL 7 DAY`;
/** A set of every latest version peaked near 233 MiB here; the superseded set near 65 MiB. */
const MEMORY_CAP_BYTES = "140000000";

let ch: ClickHouseClient;

/** One version per trace from `first`, `lagMs` after the trace's first version. */
async function seedVersions({
  first,
  count,
  lagMs,
}: {
  first: number;
  count: number;
  lagMs: number;
}) {
  await ch.command({
    query: `INSERT INTO trace_summaries (TenantId, TraceId, OccurredAt, UpdatedAt, TraceName, Attributes)
      SELECT {tenant:String}, lower(hex(sipHash128(number))),
        ${BASE} + toIntervalMillisecond(number * 100),
        ${BASE} + toIntervalMillisecond(number * 100 + ${lagMs}),
        concat('name-', toString(number % 7)),
        map('service.name', 'svc', 'langwatch.origin', if(${lagMs} = 0, 'application', 'evaluation'))
      FROM numbers(${first}, ${count})`,
    query_params: { tenant: TENANT },
    clickhouse_settings: { max_threads: 1, max_insert_threads: "1", max_block_size: "8192" },
  });
}

describe.skipIf(!clickHouseConfigured)(
  "given a window of traces, some with superseded versions",
  () => {
    beforeAll(async () => {
      ch = await startMigratedTraceClickHouse();
      for (let first = 0; first < TRACE_COUNT; first += SEED_SLICE) {
        await seedVersions({ first, count: SEED_SLICE, lagMs: 0 });
      }
      await seedVersions({ first: 0, count: SUPERSEDED, lagMs: 5_000 });
    }, 180_000);

    describe("when a read keeps only each trace's latest version", () => {
      /** @scenario "The latest-version dedup holds only superseded versions" */
      it("counts every trace once, on its latest version, under the memory cap", async () => {
        const result = await ch.query({
          query: `SELECT count() AS rows, countIf(Attributes['langwatch.origin'] = 'evaluation') AS latest
          FROM trace_summaries
          WHERE ${WINDOW} AND ${latestTraceVersionOnly({ where: WINDOW })}`,
          query_params: { tenant: TENANT },
          format: "JSONEachRow",
          clickhouse_settings: { max_memory_usage: MEMORY_CAP_BYTES, max_threads: 2 },
        });
        const [row] = await result.json<{ rows: string; latest: string }>();

        expect(Number(row?.rows)).toBe(TRACE_COUNT);
        expect(Number(row?.latest)).toBe(SUPERSEDED);
      });
    });
  },
);
