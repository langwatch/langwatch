/**
 * @vitest-environment node
 *
 * DateTime64 decode is timezone-safe.
 *
 * ClickHouse emits DateTime64(3) without a zone suffix
 * ("2026-07-24 12:00:00.123") and V8 reads a bare datetime as LOCAL time, so
 * `new Date(str)` silently skews every timestamp by the host's UTC offset.
 * That matters more here than in a display path: `occurredAt` is folded with
 * `Math.min` against each new span, so a value read back early WINS and is
 * written straight back — the drift compounds on every cache miss instead of
 * cancelling, and `OccurredAt` is the table's partition key, ORDER BY column
 * and TTL anchor.
 *
 * CI runs in UTC, where the broken and correct parses agree, so this suite
 * forces a non-UTC zone before importing anything that touches Date. Kolkata
 * is deliberate: its +05:30 offset also catches a parse that happens to align
 * on whole hours.
 */
process.env.TZ = "Asia/Kolkata";

import type { ClickHouseClient } from "@clickhouse/client";
import { describe, expect, it } from "vitest";
import { TraceAnalyticsClickHouseRepository } from "../trace-analytics.clickhouse.repository";

const TENANT_ID = "project_analyticsreadbackunit";
const TRACE_ID = "trace-tz";

/** The wire shape ClickHouse returns for JSONEachRow: DateTime64 as strings. */
function makeRepositoryReturning(record: Record<string, unknown>) {
  const client = {
    query: async () => ({
      json: async () => [record],
    }),
  } as unknown as ClickHouseClient;
  return new TraceAnalyticsClickHouseRepository(async () => client);
}

describe("TraceAnalyticsClickHouseRepository DateTime64 decode", () => {
  describe("given a row whose DateTime64 columns carry no timezone suffix", () => {
    describe("when it is read back on a host that is not on UTC", () => {
      it("decodes them as UTC rather than the host's local time", async () => {
        // Guards the guard: if Node ever stops honouring a runtime TZ change,
        // this suite would pass vacuously under CI's UTC.
        expect(new Date().getTimezoneOffset()).not.toBe(0);

        const repository = makeRepositoryReturning({
          TenantId: TENANT_ID,
          TraceId: TRACE_ID,
          Version: "v1",
          OccurredAt: "2026-07-24 12:00:00.123",
          CreatedAt: "2026-07-24 12:00:01.000",
          UpdatedAt: "2026-07-24 12:00:02.500",
        });

        const read = await repository.findByTraceIdWithApplied({
          tenantId: TENANT_ID,
          traceId: TRACE_ID,
        });

        expect(read?.row.occurredAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 0, 123));
        expect(read?.row.createdAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 1, 0));
        expect(read?.row.updatedAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 2, 500));
      });
    });
  });
});
