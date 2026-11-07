/** @vitest-environment node
 * @integration
 * The legacy free-text search over traces with large captured I/O: it finds the one span-name
 * match, and completes under a memory budget the former correlated EXISTS shape cannot fit.
 * @see specs/traces-v2/search.feature */
import type { ClickHouseClient } from "@clickhouse/client";
import type { GetAllTracesForProjectInput } from "@langwatch/trace-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../../../__tests__/support/authorization-proofs.fixture.ts";
import { openProtections } from "../../../../../repositories/clickhouse/__tests__/open-protections.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../../../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { TraceCanonicalisationService } from "../../../../derivation/services/trace-canonicalisation.service.ts";
import { TraceLegacyReadClickHouseRepository } from "../trace-legacy-read.repository.ts";
import { mappedLegacyRead } from "./support/legacy-trace-mapping.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-search-memory-${nanoid()}`;
const now = Date.now();

const TERM = "codex";

// Heavy in bytes, modest in rows: what separates the two shapes is how much
// captured text one block of traces holds. Around 57 MiB in all here, well
// inside one block by row count, inserted in small batches so seeding stays
// light on the container.
const TRACE_COUNT = 3000;
const CAPTURED_TEXT_SIZE = 10_000;
const INSERT_BATCH = 100;
const occurredAtFor = (index: number) => new Date(now - index);

// The one trace the term can find, and only through a child span's name.
const MATCHING_TRACE_INDEX = 2321;
const traceIdFor = (index: number) => `${tenantId}-trace-${index}`;

// Between what the two shapes need. Measured on ClickHouse 25.10 with this
// seed: the service's queries peak near 40 MiB, the correlated shape does not
// fit in 150 MB.
const MEMORY_CAP = "100000000"; // 100 MB

const WINDOW = { startDate: now - 60 * 60_000, endDate: now + 60_000 };

/** Printable filler that never contains the term, varied per row. */
function capturedText(seed: number): string {
  const unit = `payload ${seed.toString(36)} lorem ipsum dolor sit amet `;
  return unit.repeat(Math.ceil(CAPTURED_TEXT_SIZE / unit.length));
}

function traceRow(index: number) {
  const at = occurredAtFor(index);
  return {
    ProjectionId: `proj-${index}`,
    TenantId: tenantId,
    TraceId: traceIdFor(index),
    Version: "v1",
    Attributes: {},
    OccurredAt: at,
    CreatedAt: at,
    UpdatedAt: at,
    LastEventOccurredAt: at,
    ComputedIOSchemaVersion: "v1",
    ComputedInput: JSON.stringify({ type: "text", value: capturedText(index) }),
    ComputedOutput: JSON.stringify({
      type: "text",
      value: capturedText(index + TRACE_COUNT),
    }),
    TotalDurationMs: 100,
    SpanCount: 2,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TraceName: "checkout flow",
  };
}

function spanRow({
  index,
  spanName,
  parentSpanId = null,
}: {
  index: number;
  spanName: string;
  parentSpanId?: string | null;
}) {
  const at = occurredAtFor(index);
  return {
    ProjectionId: `proj-span-${index}-${spanName}`,
    TenantId: tenantId,
    TraceId: traceIdFor(index),
    SpanId: `span-${index}-${parentSpanId === null ? "root" : "child"}`,
    ParentSpanId: parentSpanId,
    Sampled: 1,
    StartTime: at,
    EndTime: new Date(at.getTime() + 5),
    DurationMs: 5,
    SpanName: spanName,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    CreatedAt: at,
    UpdatedAt: at,
  };
}

let ch: ClickHouseClient;

/** The test client with every query held to the memory budget, nothing else changed. */
function withMemoryCap(client: ClickHouseClient): ClickHouseClient {
  return new Proxy(client, {
    get(target, prop) {
      if (prop === "query") {
        return (params: Parameters<ClickHouseClient["query"]>[0]) =>
          target.query({
            ...params,
            clickhouse_settings: {
              ...params.clickhouse_settings,
              max_memory_usage: MEMORY_CAP,
            },
          });
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/** The legacy list search, all the way through the mapping service and its repository. */
async function searchViaLegacyList({ query, client }: { query: string; client: ClickHouseClient }) {
  const service = mappedLegacyRead({
    resolveClickHouseClient: async () => client,
    traceCanonicalisation: TraceCanonicalisationService.create(),
    annotations: {
      rows: { findForTraces: async () => [] },
      scores: { findScoreNames: async () => [] },
    },
  });
  const input: GetAllTracesForProjectInput = {
    projectId: tenantId,
    ...WINDOW,
    filters: {},
    pageSize: 100,
    query,
  };
  const results = await service.listAllTracesForProject(input, openProtections, {
    ownRead: ownProof({ projectId: tenantId }),
  });
  return {
    traceIds: results.groups.flat().map((t) => t.trace_id),
    totalHits: results.totalHits,
  };
}

/** The former count query's search shape: the three text matches ORed with a correlated
 * EXISTS over span names. The witness that the budget discriminates, so keep it the real one. */
const FORMER_CORRELATED_COUNT_SQL = `
              SELECT uniq(ts.TraceId) as total
              FROM trace_summaries ts
              WHERE ts.TenantId = {tenantId:String}
                 AND ts.OccurredAt >= fromUnixTimestamp64Milli({startDate:UInt64}) AND ts.OccurredAt <= fromUnixTimestamp64Milli({endDate:UInt64})
                 AND (lower(ifNull(ts.ComputedInput, '')) LIKE {searchQuery:String} OR lower(ifNull(ts.ComputedOutput, '')) LIKE {searchQuery:String} OR lower(ifNull(ts.TraceName, '')) LIKE {searchQuery:String} OR EXISTS (
                    SELECT 1 FROM stored_spans sp
                    WHERE sp.TenantId = {tenantId:String}
                      AND sp.TraceId = ts.TraceId
                      AND sp.StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})
                      AND sp.StartTime <= fromUnixTimestamp64Milli({endDate:UInt64})
                      AND lower(sp.SpanName) LIKE {searchQuery:String}
                  ))
            `;

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  // Merging rows this heavy takes several hundred megabytes in a small test server; files run
  // one at a time, so no other suite sees the table with merges stopped.
  await ch.command({ query: "SYSTEM STOP MERGES trace_summaries" });

  for (let start = 0; start < TRACE_COUNT; start += INSERT_BATCH) {
    const indexes = Array.from(
      { length: Math.min(INSERT_BATCH, TRACE_COUNT - start) },
      (_, offset) => start + offset,
    );
    await ch.insert({
      table: "trace_summaries",
      values: indexes.map(traceRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
    await ch.insert({
      table: "stored_spans",
      values: indexes.flatMap((index) => [
        spanRow({ index, spanName: "root" }),
        // A genuine child span: TraceName covers the root span's name, so
        // only the span-name branch can find the matching trace.
        spanRow({
          index,
          spanName: index === MATCHING_TRACE_INDEX ? "Codex.Exec" : "http.request",
          parentSpanId: `span-${index}-root`,
        }),
      ]),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}, 300_000);

afterAll(async () => {
  if (ch) {
    await ch.command({ query: "SYSTEM START MERGES trace_summaries" });
    // A lightweight delete: an ALTER ... DELETE would rewrite every heavy part.
    for (const table of ["trace_summaries", "stored_spans"]) {
      await ch.command({
        query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId },
      });
    }
  }
});

describe.skipIf(!clickHouseConfigured)("legacy free-text search memory (integration)", () => {
  describe("given traces that carry large captured input and output", () => {
    describe("when a term found only in one span name is searched", () => {
      /** @scenario The legacy messages list search completes when traces carry large captured input and output */
      it("returns that trace and nothing else", async () => {
        const found = await searchViaLegacyList({ query: TERM, client: ch });

        expect(found.traceIds).toEqual([traceIdFor(MATCHING_TRACE_INDEX)]);
        expect(found.totalHits).toBe(1);
      });
    });

    describe("when the memory budget is too tight for the correlated shape", () => {
      /** @scenario The legacy messages list search completes when traces carry large captured input and output */
      it("still completes with the same answer", async () => {
        const found = await searchViaLegacyList({ query: TERM, client: withMemoryCap(ch) });

        expect(found.traceIds).toEqual([traceIdFor(MATCHING_TRACE_INDEX)]);
        expect(found.totalHits).toBe(1);
      });

      /** @scenario The legacy messages list search completes when traces carry large captured input and output */
      it("exceeds the same budget with the correlated shape it replaced", async () => {
        await expect(
          ch
            .query({
              query: FORMER_CORRELATED_COUNT_SQL,
              query_params: {
                tenantId,
                ...WINDOW,
                searchQuery: `%${TERM}%`,
              },
              format: "JSONEachRow",
              clickhouse_settings: { max_memory_usage: MEMORY_CAP },
            })
            .then((r) => r.json()),
        ).rejects.toSatisfy((error) =>
          TraceLegacyReadClickHouseRepository.isClickHouseMemoryLimitError(error),
        );
      });
    });
  });
});
