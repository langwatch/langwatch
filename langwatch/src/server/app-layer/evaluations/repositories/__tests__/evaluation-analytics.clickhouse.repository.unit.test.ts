/**
 * @vitest-environment node
 *
 * DateTime64 decode is timezone-safe.
 *
 * ClickHouse emits DateTime64(3) without a zone suffix
 * ("2026-07-24 12:00:00.123") and V8 reads a bare datetime as LOCAL time, so
 * `new Date(str)` silently skews every timestamp by the host's UTC offset. For
 * this fold `OccurredAt` doubles as the out-of-order checkpoint
 * (`LastEventOccurredAt`), so a skew here mis-orders event application rather
 * than merely displaying a wrong time.
 *
 * CI runs in UTC, where the broken and correct parses agree, so this suite
 * forces a non-UTC zone before importing anything that touches Date. Kolkata
 * is deliberate: its +05:30 offset also catches a parse that happens to align
 * on whole hours.
 */
process.env.TZ = "Asia/Kolkata";

import type { ClickHouseClient } from "@clickhouse/client";
import { register } from "prom-client";
import { describe, expect, it } from "vitest";
import { EvaluationAnalyticsClickHouseRepository } from "../evaluation-analytics.clickhouse.repository";

const TENANT_ID = "project_analyticsreadbackunit";
const EVALUATION_ID = "eval-tz";
const TABLE = "evaluation_analytics";

interface CapturedQuery {
  query: string;
  query_params?: Record<string, unknown>;
}

/** The wire shape ClickHouse returns for JSONEachRow: DateTime64 as strings. */
function makeRepositoryReturning(record: Record<string, unknown>) {
  const client = {
    query: async () => ({
      json: async () => [record],
    }),
  } as unknown as ClickHouseClient;
  return new EvaluationAnalyticsClickHouseRepository(async () => client);
}

/**
 * A ClickHouse stand-in that actually applies the ORDER BY the repository sent,
 * over rows handed to it in a deliberately adverse order. A repository that
 * dropped its tiebreak — or pointed it at the wrong column or direction — then
 * returns the stale version and the test fails, instead of passing on the
 * fixture's insertion order the way a plain passthrough mock would.
 *
 * Understands only the grammar the repository emits: comma-separated
 * `<column> ASC|DESC` and `length(<column>) DESC` keys, then LIMIT 1.
 */
function makeOrderingRepository(rows: Array<Record<string, unknown>>) {
  const seen: CapturedQuery[] = [];
  const client = {
    query: async (params: CapturedQuery) => {
      seen.push(params);
      return { json: async () => applyOrderBy(rows, params.query).slice(0, 1) };
    },
  } as unknown as ClickHouseClient;
  return {
    repository: new EvaluationAnalyticsClickHouseRepository(async () => client),
    seen,
  };
}

function applyOrderBy(
  rows: Array<Record<string, unknown>>,
  query: string,
): Array<Record<string, unknown>> {
  const clause = /ORDER BY([\s\S]*?)LIMIT/i.exec(query)?.[1];
  if (clause === undefined) return [...rows];

  const keys = clause
    .split(",")
    .map((key) => key.trim())
    .filter((key) => key.length > 0)
    .map((key) => {
      const descending = /\bDESC\b/i.test(key);
      const expression = key.replace(/\b(ASC|DESC)\b/i, "").trim();
      const arrayLength = /^length\((.+)\)$/i.exec(expression);
      return {
        column: arrayLength ? arrayLength[1]!.trim() : expression,
        descending,
        byLength: arrayLength !== null,
      };
    });

  return [...rows].sort((left, right) => {
    for (const { column, descending, byLength } of keys) {
      const a = sortValue(left[column], byLength);
      const b = sortValue(right[column], byLength);
      if (a === b) continue;
      return (a < b ? -1 : 1) * (descending ? -1 : 1);
    }
    return 0;
  });
}

/** UInt64 columns arrive as strings on the wire; DateTime64 sorts lexically. */
function sortValue(raw: unknown, byLength: boolean): number | string {
  if (byLength) return Array.isArray(raw) ? raw.length : 0;
  if (typeof raw === "number") return raw;
  const asString = String(raw);
  return asString !== "" && !Number.isNaN(Number(asString))
    ? Number(asString)
    : asString;
}

async function windowedReadCount(outcome: string): Promise<number> {
  const metric = register.getSingleMetric("clickhouse_windowed_read_total");
  if (!metric) return 0;
  const snapshot = await metric.get();
  return (
    snapshot.values.find(
      (value) =>
        value.labels.table === TABLE && value.labels.outcome === outcome,
    )?.value ?? 0
  );
}

/**
 * A committed version of one evaluation. `OccurredAt` carries this fold's
 * progress watermark (it is written from `state.LastEventOccurredAt`), and the
 * lifecycle stamps ride as UInt64 epoch-ms strings with "0" meaning unset.
 */
function tiedVersion({
  occurredAt,
  startedAt,
  completedAt,
  appliedEventIds,
}: {
  occurredAt: string;
  startedAt: string;
  completedAt: string;
  appliedEventIds: string[];
}): Record<string, unknown> {
  return {
    TenantId: TENANT_ID,
    EvaluationId: EVALUATION_ID,
    Version: "v1",
    // Both versions carry the SAME UpdatedAt: the premise of the whole suite is
    // that they tie, so both satisfy the IN-tuple dedup.
    UpdatedAt: "2026-07-24 12:00:02.500",
    CreatedAt: "2026-07-24 12:00:01.000",
    OccurredAt: occurredAt,
    StartedAt: startedAt,
    CompletedAt: completedAt,
    AppliedEventIds: appliedEventIds,
  };
}

describe("EvaluationAnalyticsClickHouseRepository DateTime64 decode", () => {
  describe("given a row whose DateTime64 columns carry no timezone suffix", () => {
    describe("when it is read back on a host that is not on UTC", () => {
      it("decodes them as UTC rather than the host's local time", async () => {
        // Guards the guard: if Node ever stops honouring a runtime TZ change,
        // this suite would pass vacuously under CI's UTC.
        expect(new Date().getTimezoneOffset()).not.toBe(0);

        const repository = makeRepositoryReturning({
          TenantId: TENANT_ID,
          EvaluationId: EVALUATION_ID,
          Version: "v1",
          OccurredAt: "2026-07-24 12:00:00.123",
          CreatedAt: "2026-07-24 12:00:01.000",
          UpdatedAt: "2026-07-24 12:00:02.500",
        });

        const read = await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
        });

        expect(read?.row.occurredAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 0, 123));
        expect(read?.row.createdAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 1, 0));
        expect(read?.row.updatedAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 2, 500));
      });
    });
  });
});

/**
 * Two physical versions of one evaluation can tie on UpdatedAt: the fold stamps
 * `max(Date.now(), prev + 1)`, monotonic only within one state chain, so two
 * writers resuming from the same committed version land on the same ms. Both
 * then satisfy the IN-tuple dedup, and a bare LIMIT 1 picks arbitrarily —
 * resuming the fold from stale state that it rewrites, dropping the other
 * version's contributions and its applied-id watermark.
 */
describe("EvaluationAnalyticsClickHouseRepository tied-version read", () => {
  describe("given two committed versions of an evaluation that tie on UpdatedAt", () => {
    describe("when the stale version is the one ClickHouse would reach first", () => {
      it("returns the version that folded the latest lifecycle event", async () => {
        const { repository } = makeOrderingRepository([
          tiedVersion({
            occurredAt: "2026-07-24 12:00:00.000",
            startedAt: "1750000000000",
            completedAt: "0",
            appliedEventIds: ["a"],
          }),
          tiedVersion({
            occurredAt: "2026-07-24 12:00:09.000",
            startedAt: "1750000000000",
            completedAt: "1750000009000",
            appliedEventIds: ["a", "b"],
          }),
        ]);

        const read = await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
        });

        expect(read?.row.occurredAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 9, 0));
        expect(read?.row.completedAtMs).toBe(1750000009000);
        expect(read?.appliedEventIds).toEqual(["a", "b"]);
      });
    });

    describe("when they also share the latest folded event time", () => {
      it("returns the version that recorded completion", async () => {
        const { repository } = makeOrderingRepository([
          tiedVersion({
            occurredAt: "2026-07-24 12:00:09.000",
            startedAt: "1750000000000",
            // Unset reads back as 0, so it must sort behind a real stamp.
            completedAt: "0",
            appliedEventIds: ["a"],
          }),
          tiedVersion({
            occurredAt: "2026-07-24 12:00:09.000",
            startedAt: "1750000000000",
            completedAt: "1750000009000",
            appliedEventIds: ["a", "b"],
          }),
        ]);

        const read = await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
        });

        expect(read?.row.completedAtMs).toBe(1750000009000);
        expect(read?.appliedEventIds).toEqual(["a", "b"]);
      });
    });
  });
});

describe("EvaluationAnalyticsClickHouseRepository windowed read", () => {
  describe("given a caller-supplied window", () => {
    describe("when the read runs", () => {
      it("counts the read on the windowed-read metric as a window hit", async () => {
        const before = await windowedReadCount("hit");
        const { repository } = makeOrderingRepository([]);

        await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(await windowedReadCount("hit")).toBe(before + 1);
      });

      it("passes the caller's bounds through to ClickHouse unchanged", async () => {
        // queryWindowed takes a centre + half-width, so the bounds make a
        // round-trip through `(from + to) / 2` and `(to - from) / 2`. An odd
        // width lands the halves on .5 and still has to reconstruct exactly.
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(seen[0]?.query_params?.from).toBe(1_750_000_000_000);
        expect(seen[0]?.query_params?.to).toBe(1_750_000_345_679);
      });

      it("bounds the outer scope only, leaving the dedup subquery unwindowed", async () => {
        // Windowing the inner scope too would let an evaluation whose latest
        // version drifted out of the window read back as a stale in-window
        // version — a non-null answer no fallback can catch.
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        const query = seen[0]?.query ?? "";
        const innerScopeStart = query.indexOf("IN (");
        const outerScope = query.slice(0, innerScopeStart);
        const innerScope = query.slice(
          innerScopeStart,
          query.indexOf("GROUP BY"),
        );

        expect(outerScope).toContain("fromUnixTimestamp64Milli");
        expect(innerScope).not.toContain("fromUnixTimestamp64Milli");
      });
    });
  });

  describe("given no window", () => {
    describe("when the read runs", () => {
      it("counts the read on the windowed-read metric as unwindowed", async () => {
        const before = await windowedReadCount("unwindowed");
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
        });

        expect(await windowedReadCount("unwindowed")).toBe(before + 1);
        expect(seen[0]?.query).not.toContain("fromUnixTimestamp64Milli");
      });
    });
  });
});
