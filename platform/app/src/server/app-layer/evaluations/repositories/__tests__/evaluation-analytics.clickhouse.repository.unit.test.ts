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
// Through node:process, NOT the global. Under a vm pool with isolate:false a
// worker reuses one context across files, and the `process` global vitest
// hands that context wraps the real one — assigning TZ on it misses Node's
// native env setter, which is the thing that flushes V8's cached timezone.
// So whenever another file had already used Date in this worker, the
// assignment silently did nothing, the guard below collapsed to "expected +0
// not to be +0", and which files shared a worker depended on the sequencer —
// a per-shard coin flip. node:process is the real object; its setter flushes
// the cache even mid-context. Verified against a deterministic repro
// (TZ=UTC, one worker, a Date-using suite loaded first).
import { env as nodeProcessEnv } from "node:process";

nodeProcessEnv.TZ = "Asia/Kolkata";

import { describe, expect, it } from "vitest";
import {
  EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
  type EvaluationAnalyticsRow,
} from "~/server/event-sourcing/pipelines/evaluation-processing/projections/evaluationAnalytics.foldProjection";
import {
  capturingInsertClient,
  clientReturning,
  orderingClient,
  windowedReadCount,
} from "../../../analytics/__tests__/clickhouse-repository-test-helpers";
import { EvaluationAnalyticsClickHouseRepository } from "../evaluation-analytics.clickhouse.repository";

const TENANT_ID = "project_analyticsreadbackunit";
const EVALUATION_ID = "eval-tz";
const TABLE = "evaluation_analytics";

function makeRepositoryReturning(record: Record<string, unknown>) {
  return new EvaluationAnalyticsClickHouseRepository(async () =>
    clientReturning(record),
  );
}

function makeOrderingRepository(rows: Array<Record<string, unknown>>) {
  const { client, seen } = orderingClient(rows);
  return {
    repository: new EvaluationAnalyticsClickHouseRepository(async () => client),
    seen,
  };
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

        expect(read?.row.occurredAtMs).toBe(
          Date.UTC(2026, 6, 24, 12, 0, 0, 123),
        );
        expect(read?.row.createdAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 1, 0));
        expect(read?.row.updatedAtMs).toBe(
          Date.UTC(2026, 6, 24, 12, 0, 2, 500),
        );
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

    describe("when the keys disagree about which version is further along", () => {
      it("ranks by the latest folded event before completion or applied count", async () => {
        // The other fixtures move every key the same way, so an ORDER BY that
        // collapsed to its last key alone would still pass them. Here the keys
        // point at different rows, which is what actually pins the priority.
        const { repository } = makeOrderingRepository([
          tiedVersion({
            occurredAt: "2026-07-24 12:00:00.000",
            startedAt: "1750000000000",
            completedAt: "1750000009000",
            appliedEventIds: ["a", "b", "c"],
          }),
          tiedVersion({
            // Latest folded event — the leading key...
            occurredAt: "2026-07-24 12:00:09.000",
            startedAt: "1750000000000",
            // ...while behind on every key that follows it.
            completedAt: "0",
            appliedEventIds: ["z"],
          }),
        ]);

        const read = await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
        });

        // Unset round-trips as null, not zero — the winner here is the version
        // that has folded furthest, not the one that has finished.
        expect(read?.row.completedAtMs).toBeNull();
        expect(read?.appliedEventIds).toEqual(["z"]);
      });
    });
  });
});

describe("EvaluationAnalyticsClickHouseRepository windowed read", () => {
  describe("given a caller-supplied window", () => {
    describe("when the read runs", () => {
      it("counts the read on the windowed-read metric as a window hit", async () => {
        const before = await windowedReadCount({
          table: TABLE,
          outcome: "hit",
        });
        // A row, so this is a genuine hit — an empty read is its own outcome
        // now (see below), and asserting `hit` off an empty fake would pin
        // the wrong half of the contract.
        const { repository } = makeOrderingRepository([
          tiedVersion({
            occurredAt: "2026-07-24 12:00:00.000",
            startedAt: "1750000000000",
            completedAt: "0",
            appliedEventIds: ["a"],
          }),
        ]);

        await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(await windowedReadCount({ table: TABLE, outcome: "hit" })).toBe(
          before + 1,
        );
      });

      /**
       * This read declares its window authoritative (`fallback: "none"`), so a
       * miss never widens and has no widen outcome to appear as. It is counted
       * as a miss instead of folded into `hit`.
       */
      /** @scenario a bounded miss is recorded as a miss, not as an answer */
      it("counts an empty window as a miss, not as a hit", async () => {
        const beforeEmpty = await windowedReadCount({
          table: TABLE,
          outcome: "windowed_empty",
        });
        const beforeHit = await windowedReadCount({
          table: TABLE,
          outcome: "hit",
        });
        const { repository } = makeOrderingRepository([]);

        await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(
          await windowedReadCount({ table: TABLE, outcome: "windowed_empty" }),
        ).toBe(beforeEmpty + 1);
        expect(await windowedReadCount({ table: TABLE, outcome: "hit" })).toBe(
          beforeHit,
        );
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
        const before = await windowedReadCount({
          table: TABLE,
          outcome: "unwindowed",
        });
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByEvaluationIdWithApplied({
          tenantId: TENANT_ID,
          evaluationId: EVALUATION_ID,
        });

        expect(
          await windowedReadCount({ table: TABLE, outcome: "unwindowed" }),
        ).toBe(before + 1);
        expect(seen[0]?.query).not.toContain("fromUnixTimestamp64Milli");
      });
    });
  });
});

/**
 * The write half of the migration window (ADR-066).
 *
 * `wrapWithDefaultSettings` proxies only `.query`, so an insert carries exactly
 * the settings the repository passes and nothing else. ClickHouse defaults
 * `input_format_skip_unknown_fields` ON, and the workers Deployment overrides
 * the entrypoint so it never runs migrations — they run in the app pod's boot,
 * and the two roll concurrently. Without the explicit 0, a worker writing before
 * migration 00056 applies gets HTTP 200 with the new columns dropped and the row
 * stamped at the CURRENT projection version, so it later passes the store's
 * version gate and decodes as all-defaults with no rebuild path.
 */
describe("EvaluationAnalyticsClickHouseRepository insert settings", () => {
  const ROW: EvaluationAnalyticsRow = {
    tenantId: TENANT_ID,
    evaluationId: EVALUATION_ID,
    version: EVALUATION_ANALYTICS_PROJECTION_VERSION_LATEST,
    occurredAtMs: 1_750_000_000_000,
    createdAtMs: 1_750_000_000_000,
    updatedAtMs: 1_750_000_000_000,
    evaluatorType: "langevals/llm_answer_match",
    evaluatorName: "Judge",
    status: "processed",
    isGuardrail: false,
    passed: null,
    score: null,
    label: null,
    model: null,
    traceId: "trace-1",
    userId: null,
    conversationId: null,
    customerId: null,
    origin: null,
    durationMs: 0,
    totalCost: null,
    nonBilledCost: null,
    attributes: {},
    startedAtMs: 1_750_000_000_000,
    completedAtMs: null,
  };

  describe("given a table that predates the row's columns", () => {
    describe("when a single row is upserted", () => {
      it("refuses to let ClickHouse silently drop an unknown column", async () => {
        const { client, inserts } = capturingInsertClient();
        const repository = new EvaluationAnalyticsClickHouseRepository(
          async () => client,
        );

        await repository.upsert(ROW);

        expect(inserts[0]?.clickhouse_settings).toMatchObject({
          input_format_skip_unknown_fields: 0,
        });
      });
    });

    describe("when a batch is upserted", () => {
      it("refuses to let ClickHouse silently drop an unknown column", async () => {
        const { client, inserts } = capturingInsertClient();
        const repository = new EvaluationAnalyticsClickHouseRepository(
          async () => client,
        );

        await repository.upsertBatch([{ row: ROW }]);

        expect(inserts[0]?.clickhouse_settings).toMatchObject({
          input_format_skip_unknown_fields: 0,
        });
      });
    });
  });
});
