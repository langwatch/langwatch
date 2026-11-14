/**
 * @vitest-environment node
 * DateTime64 decode is timezone-safe (forces Kolkata). Sets TZ via
 * node:process, not the global — isolate:false needs Node's native setter.
 */
import { env as nodeProcessEnv } from "node:process";

nodeProcessEnv.TZ = "Asia/Kolkata";

import { type ClickHouseQueryClient, setWindowedReadMetrics } from "@langwatch/clickhouse-client";
import {
  idIndexedClientDouble,
  type ScriptedStatements,
} from "@langwatch/clickhouse-client/testing";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import type { TraceAnalyticsRow } from "#eventing/trace-derived.projection";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { TRACE_ANALYTICS_MATERIALIZED_METADATA_COLUMNS } from "../../../rules/trace-widget-columns.rules.ts";
import { TRACE_ID_INDEXES } from "../clickhouse.trace-id-indexes.database.ts";
import type { TraceClickHouseWriteClient } from "../clickhouse.trace-member-client.repository.ts";
import { TraceAnalyticsClickHouseRepository } from "../trace-metrics-analytics.repository.ts";
import {
  capturingInsertClient,
  clientReturning,
  orderingClient,
  TestWindowedReadMetrics,
} from "./clickhouse-test-helpers.ts";

const TENANT_ID = "project_analyticsreadbackunit";
const AUTHORIZATION = ownProof({ projectId: TENANT_ID });
const TRACE_ID = "trace-tz";
const TABLE = "trace_analytics";
/** The policy counts through one process-wide sink, so the test registers its own. */
const windowedReadMetrics = new TestWindowedReadMetrics();
setWindowedReadMetrics(windowedReadMetrics);

/** The built read path over a legacy-shaped double: rendered SQL in, `{ rows }` out. */
function readsOver(client: TraceClickHouseWriteClient): Pick<ClickHouseQueryClient, "read"> {
  return idIndexedClientDouble({
    indexes: TRACE_ID_INDEXES,
    driver: {
      execute: vi.fn<ScriptedStatements["execute"]>(async ({ sql, params = {} }) => {
        const result = await client.query({
          query: sql,
          query_params: params,
          format: "JSONEachRow",
        });
        return { rows: await result.json() };
      }),
    },
  });
}

function makeRepositoryReturning(record: Record<string, unknown>) {
  return TraceAnalyticsClickHouseRepository.create({
    resolveClient: async () => clientReturning(record),
    reader: readsOver(clientReturning(record)),
  });
}

function makeOrderingRepository(rows: Record<string, unknown>[]) {
  const { client, seen } = orderingClient(rows);
  return {
    repository: TraceAnalyticsClickHouseRepository.create({
      resolveClient: async () => client,
      reader: readsOver(client),
    }),
    seen,
  };
}

/** A committed version of one trace, with the fold-progress columns spelled out. */
function tiedVersion({
  lastEventOccurredAt,
  spanCount,
  appliedEventIds,
  occurredAt,
}: {
  lastEventOccurredAt: string;
  spanCount: number;
  appliedEventIds: string[];
  occurredAt: string;
}): Record<string, unknown> {
  return {
    TenantId: TENANT_ID,
    TraceId: TRACE_ID,
    Version: "v1",
    // Both versions carry the SAME UpdatedAt: the premise of the whole suite is
    // that they tie, so both satisfy the IN-tuple dedup.
    UpdatedAt: "2026-07-24 12:00:02.500",
    CreatedAt: "2026-07-24 12:00:01.000",
    OccurredAt: occurredAt,
    LastEventOccurredAt: lastEventOccurredAt,
    SpanCount: spanCount,
    AppliedEventIds: appliedEventIds,
  };
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

        const read = await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
        });

        expect(read?.row.occurredAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 0, 123));
        expect(read?.row.createdAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 1, 0));
        expect(read?.row.updatedAtMs).toBe(Date.UTC(2026, 6, 24, 12, 0, 2, 500));
      });
    });
  });
});

/**
 * Two physical versions of one trace can tie on UpdatedAt (the fold's
 * `max(Date.now(), prev+1)` stamp is monotonic only per chain). A bare
 * LIMIT 1 then picks arbitrarily, resuming from stale, dropped state.
 */
describe("TraceAnalyticsClickHouseRepository tied-version read", () => {
  describe("given two committed versions of a trace that tie on UpdatedAt", () => {
    describe("when the stale version is the one ClickHouse would reach first", () => {
      it("returns the version that folded the latest event", async () => {
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 3,
            appliedEventIds: ["a", "b"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
          tiedVersion({
            lastEventOccurredAt: "1750000009999",
            spanCount: 7,
            appliedEventIds: ["a", "b", "c", "d"],
            // The winner's OccurredAt is EARLIER: it is min(span start), which
            // only decreases as earlier spans land late.
            occurredAt: "2026-07-24 11:59:59.000",
          }),
        ]);

        const read = await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
        });

        expect(read?.row.lastEventOccurredAt).toBe(1750000009999);
        expect(read?.row.spanCount).toBe(7);
        expect(read?.appliedEventIds).toEqual(["a", "b", "c", "d"]);
      });
    });

    describe("when they also share the latest folded event time", () => {
      it("returns the version with more of the trace folded in", async () => {
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 2,
            appliedEventIds: ["a"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 9,
            appliedEventIds: ["a", "b", "c"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
        ]);

        const read = await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
        });

        expect(read?.row.spanCount).toBe(9);
        expect(read?.appliedEventIds).toEqual(["a", "b", "c"]);
      });
    });

    describe("when the keys disagree about which version is further along", () => {
      it("ranks by the latest folded event before any other key", async () => {
        // Every other fixture in this suite moves all four keys the same way,
        // so a collapsed ORDER BY — one that dropped LastEventOccurredAt, or
        // promoted OccurredAt ASC to first — still passes them. Here the keys
        // point at DIFFERENT rows, which is the only shape that pins the
        // priority the query's docstring argues for.
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000000",
            spanCount: 12,
            appliedEventIds: ["a", "b", "c", "d", "e"],
            occurredAt: "2026-07-24 11:00:00.000",
          }),
          tiedVersion({
            // Further along by the only key that measures fold progress...
            lastEventOccurredAt: "1750000009999",
            // ...and behind on every key that does not.
            spanCount: 1,
            appliedEventIds: ["z"],
            occurredAt: "2026-07-24 13:00:00.000",
          }),
        ]);

        const read = await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
        });

        expect(read?.row.lastEventOccurredAt).toBe(1750000009999);
        expect(read?.appliedEventIds).toEqual(["z"]);
      });
    });
  });
});

describe("TraceAnalyticsClickHouseRepository windowed read", () => {
  describe("given a caller-supplied window", () => {
    describe("when the read runs", () => {
      it("counts the read on the windowed-read metric as a window hit", async () => {
        const before = windowedReadMetrics.count({
          table: TABLE,
          outcome: "hit",
        });
        // A row, so this is a genuine hit. The empty case is its own outcome
        // (see below) — asserting `hit` off an empty read would pin the wrong
        // half of the contract.
        const { repository } = makeOrderingRepository([
          tiedVersion({
            lastEventOccurredAt: "1750000000001",
            spanCount: 1,
            appliedEventIds: ["a"],
            occurredAt: "2026-07-24 12:00:00.000",
          }),
        ]);

        await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(windowedReadMetrics.count({ table: TABLE, outcome: "hit" })).toBe(before + 1);
      });

      /**
       * This read declares its window authoritative, so a miss never widens and
       * has no widen outcome to appear as. It gets counted as a miss instead of
       * folded into `hit`.
       */
      /** @scenario a bounded miss is recorded as a miss, not as an answer */
      it("counts an empty window as a miss, not as a hit", async () => {
        const beforeEmpty = windowedReadMetrics.count({
          table: TABLE,
          outcome: "windowed_empty",
        });
        const beforeHit = windowedReadMetrics.count({
          table: TABLE,
          outcome: "hit",
        });
        const { repository } = makeOrderingRepository([]);

        await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        expect(windowedReadMetrics.count({ table: TABLE, outcome: "windowed_empty" })).toBe(
          beforeEmpty + 1,
        );
        expect(windowedReadMetrics.count({ table: TABLE, outcome: "hit" })).toBe(beforeHit);
      });

      it("passes the caller's bounds through to ClickHouse unchanged", async () => {
        // queryWindowed takes a centre + half-width, so the bounds make a
        // round-trip through `(from + to) / 2` and `(to - from) / 2`. An odd
        // width lands the halves on .5 and still has to reconstruct exactly.
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        // Built parameters are named `v<n>`, so the bounds are found by value.
        expect(Object.values(seen[0]?.query_params ?? {})).toEqual(
          expect.arrayContaining([1_750_000_000_000, 1_750_000_345_679]),
        );
      });

      it("bounds the outer scope only, leaving the dedup subquery unwindowed", async () => {
        // Windowing the inner scope too would let a trace whose latest version
        // drifted out of the window read back as a stale in-window version — a
        // non-null answer no fallback can catch.
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
          window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
        });

        // The fence the proof expands into is itself an `IN (...)`, so the
        // dedup subquery is found by its tuple, not by the first `IN`.
        const query = seen[0]?.query ?? "";
        const innerScopeStart = query.indexOf("(TenantId, TraceId, UpdatedAt) IN (");
        const outerScope = query.slice(0, innerScopeStart);
        const innerScope = query.slice(innerScopeStart, query.indexOf("GROUP BY"));

        expect(outerScope).toContain("fromUnixTimestamp64Milli");
        expect(innerScope).not.toContain("fromUnixTimestamp64Milli");
      });
    });
  });

  describe("given no window", () => {
    describe("when the read runs", () => {
      it("counts the read on the windowed-read metric as unwindowed", async () => {
        const before = windowedReadMetrics.count({
          table: TABLE,
          outcome: "unwindowed",
        });
        const { repository, seen } = makeOrderingRepository([]);

        await repository.findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
        });

        expect(windowedReadMetrics.count({ table: TABLE, outcome: "unwindowed" })).toBe(before + 1);
        expect(seen[0]?.query).not.toContain("fromUnixTimestamp64Milli");
      });
    });
  });
});

/**
 * The write half of the migration window (ADR-066): without explicit
 * `input_format_skip_unknown_fields: 0`, a pre-migration-00056 writer gets
 * HTTP 200 with new columns silently dropped, decoding as all-defaults.
 */
describe("TraceAnalyticsClickHouseRepository insert settings", () => {
  const ROW: TraceAnalyticsRow = {
    tenantId: TENANT_ID,
    traceId: TRACE_ID,
    version: "2026-07-27",
    hasSignal: true,
    occurredAtMs: 1_750_000_000_000,
    createdAtMs: 1_750_000_000_000,
    updatedAtMs: 1_750_000_000_000,
    traceName: "t",
    topicId: null,
    subTopicId: null,
    userId: null,
    conversationId: null,
    customerId: null,
    origin: "playground",
    models: [],
    labels: [],
    totalCost: null,
    nonBilledCost: null,
    unpricedSpanCount: 0,
    unpricedModels: [],
    totalDurationMs: 0,
    timeToFirstTokenMs: null,
    tokensPerSecond: null,
    promptTokens: null,
    completionTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    reasoningTokens: null,
    hasError: false,
    hasAnnotation: null,
    attributes: {},
    spanCount: 1,
    annotationIds: [],
    rootSpanStartTimeMs: 0,
    traceNameFromFallback: false,
    rootMetadataFromFallback: false,
    traceNameUserOverridden: false,
    lastEventOccurredAt: 1_750_000_000_000,
    earliestSpanStartMs: 1_750_000_000_000,
  };

  describe("given a table that predates the row's columns", () => {
    describe("when a single row is upserted", () => {
      it("refuses to let ClickHouse silently drop an unknown column", async () => {
        const { client, inserts } = capturingInsertClient();
        const repository = TraceAnalyticsClickHouseRepository.create({
          resolveClient: async () => client,
          reader: readsOver(client),
        });

        await repository.upsert({ row: ROW, retentionDays: 30 });

        expect(inserts[0]?.clickhouse_settings).toMatchObject({
          input_format_skip_unknown_fields: 0,
        });
      });
    });

    describe("when a trace carries the metadata keys the stock widgets read", () => {
      /** @scenario "The fold never inserts a column the database computes" */
      it("inserts the plain metadata columns and none of the MATERIALIZED ones", async () => {
        const { client, inserts } = capturingInsertClient();
        const repository = TraceAnalyticsClickHouseRepository.create({
          resolveClient: async () => client,
          reader: readsOver(client),
        });

        await repository.upsert({
          row: {
            ...ROW,
            attributes: {
              "metadata.output_action": "approve",
              "metadata.team": "platform",
              "metadata.environment": "prod",
            },
          },
          retentionDays: 30,
        });

        const inserted = Object.keys(inserts[0]?.values?.[0] ?? {});
        const materialized = inserted.filter((c) =>
          TRACE_ANALYTICS_MATERIALIZED_METADATA_COLUMNS.has(c),
        );
        expect(materialized).toEqual([]);
        expect(inserted).toEqual(
          expect.arrayContaining([
            "MetadataOutcomeReason",
            "MetadataPromptVersion",
            "MetadataEnvironment",
          ]),
        );
      });
    });

    describe("when a batch is upserted", () => {
      it("refuses to let ClickHouse silently drop an unknown column", async () => {
        const { client, inserts } = capturingInsertClient();
        const repository = TraceAnalyticsClickHouseRepository.create({
          resolveClient: async () => client,
          reader: readsOver(client),
        });

        await repository.upsertBatch([{ row: ROW, retentionDays: 30 }]);

        expect(inserts[0]?.clickhouse_settings).toMatchObject({
          input_format_skip_unknown_fields: 0,
        });
      });
    });
  });
});

describe("TraceAnalyticsClickHouseRepository evaluation outcomes read-back", () => {
  const committed = (evaluationOutcomes: string) => ({
    TenantId: TENANT_ID,
    TraceId: TRACE_ID,
    Version: "v1",
    OccurredAt: "2026-07-24 12:00:00.000",
    CreatedAt: "2026-07-24 12:00:01.000",
    UpdatedAt: "2026-07-24 12:00:02.500",
    EvaluationOutcomes: evaluationOutcomes,
  });

  describe("given a committed row whose outcomes do not decode", () => {
    describe("when the fold reads it back", () => {
      /** @scenario "Unreadable stored outcomes are rebuilt from the trace's events, never stored over" */
      it.each([
        ["not json", "{not json"],
        ["off schema", JSON.stringify({ "eval-1": { status: 1 } })],
      ])("reports the row undecodable when the column is %s", async (_label, text) => {
        const read = await makeRepositoryReturning(committed(text)).findByTraceId({
          authorization: AUTHORIZATION,
          traceId: TRACE_ID,
        });

        expect(read?.undecodable).toBe(true);
      });
    });
  });

  describe("given a committed row whose outcomes decode", () => {
    describe("when the fold reads it back", () => {
      it("returns them and reports the row readable", async () => {
        const outcome = {
          evaluatorName: "Faithfulness",
          isGuardrail: false,
          status: "processed",
          passed: true,
          label: null,
          evaluationOccurredAt: 1_750_000_000_000,
          sourceEventId: "evt-1",
        };

        const read = await makeRepositoryReturning(
          committed(JSON.stringify({ "eval-1": outcome })),
        ).findByTraceId({ authorization: AUTHORIZATION, traceId: TRACE_ID });

        expect(read?.undecodable).toBeUndefined();
        expect(read?.row.evaluationOutcomes).toEqual({ "eval-1": outcome });
      });
    });
  });
});

describe("TraceAnalyticsClickHouseRepository built reads", () => {
  type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

  /** A reader answering `rows` to each request and keeping them. */
  function builtRepository(rows: Record<string, unknown>[]) {
    const requests: ReadRequest[] = [];
    const repository = TraceAnalyticsClickHouseRepository.create({
      resolveClient: async () => clientReturning({}),
      reader: clickHouseQueryClientDouble({
        async read(request: ReadRequest) {
          requests.push(request);
          return { rows };
        },
      }),
    });
    return { repository, requests };
  }

  function expectReaderFence(request: ReadRequest | undefined) {
    expect(request?.table).toBe(TABLE);
    expect(request?.statement).toMatchObject({
      kind: "tenant",
      identity: "reader",
      tenantIds: [TENANT_ID],
      settings: { SQL_langwatch_tenant_ids: TENANT_ID },
    });
  }

  describe("given a trace's analytics row read back with no window", () => {
    /** @scenario "A trace's analytics row and the anchors of many traces are read within the reader's proof" */
    it("elects the latest version by the index and ranks tied versions", async () => {
      const { repository, requests } = builtRepository([
        tiedVersion({
          lastEventOccurredAt: "2",
          spanCount: 1,
          appliedEventIds: ["e1"],
          occurredAt: "2026-07-24 12:00:00.000",
        }),
      ]);

      const read = await repository.findByTraceId({
        authorization: AUTHORIZATION,
        traceId: TRACE_ID,
      });

      expect(requests).toHaveLength(1);
      expectReaderFence(requests[0]);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toContain("max(UpdatedAt)");
      expect(sql).toMatch(
        /ORDER BY TenantId ASC, LastEventOccurredAt DESC, SpanCount DESC, length\(AppliedEventIds\) DESC, OccurredAt ASC, toString\(AppliedEventIds\) DESC LIMIT 1$/,
      );
      expect(sql).not.toContain(TRACE_ID);
      expect(requests[0]?.idBound).toEqual({ fallback: "none" });
      expect(read?.appliedEventIds).toEqual(["e1"]);
    });
  });

  describe("given many traces' anchors read with no window", () => {
    /** @scenario "A trace's analytics row and the anchors of many traces are read within the reader's proof" */
    it("reads each trace's latest OccurredAt once, bounded by the index", async () => {
      const { repository, requests } = builtRepository([{ TraceId: TRACE_ID, OccurredAtMs: "5" }]);

      const anchors = await repository.findOccurredAtByTraceIds({
        authorization: AUTHORIZATION,
        traceIds: [TRACE_ID, TRACE_ID],
      });

      expect(requests).toHaveLength(1);
      expectReaderFence(requests[0]);
      const sql = requests[0]?.statement.sql ?? "";
      expect(sql).toContain("argMax(OccurredAt, UpdatedAt)");
      expect(sql).toMatch(/GROUP BY TenantId, TraceId$/);
      expect(requests[0]?.idBound).toEqual({ fallback: "unbounded" });
      expect(anchors).toEqual([{ traceId: TRACE_ID, occurredAtMs: 5 }]);
    });
  });

  describe("given many traces' anchors read within a window", () => {
    /** @scenario "A trace's analytics row and the anchors of many traces are read within the reader's proof" */
    it("bounds the read by the window, not the index", async () => {
      const { repository, requests } = builtRepository([]);

      await repository.findOccurredAtByTraceIds({
        authorization: AUTHORIZATION,
        traceIds: [TRACE_ID],
        window: { fromMs: 1_750_000_000_000, toMs: 1_750_000_345_679 },
      });

      expectReaderFence(requests[0]);
      expect(requests[0]?.statement.sql).toContain("OccurredAt >= fromUnixTimestamp64Milli(");
      expect(requests[0]?.idBound).toBeUndefined();
    });
  });
});
