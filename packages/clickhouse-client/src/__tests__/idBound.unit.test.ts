/**
 * The `{{idBound}}` marker: a read by id names its table, key and id, and the reader adds the
 * bound its declared id index names, over the real client, the fenced reader and a driver spy.
 * Spec: specs/clickhouse/id-index-reads.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TenantScopedReader } from "../authorized-reads.ts";
import { ClickHouseQueryClient } from "../client.ts";
import { defineIdIndex } from "../idIndexFill.ts";
import { ID_INDEX_WIDEN_MS } from "../indexedRead.ts";
import type { QueryDriver, QueryRequest } from "../query.ts";
import { TenantGuard } from "../tenantGuard.ts";
import {
  RESOLVER_RECENT_WINDOW_MS,
  setWindowedReadMetrics,
  type WindowedReadOutcome,
} from "../windowedRead.ts";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SPANS = defineIdIndex({ source: "stored_spans", key: ["TraceId"], time: "StartTime" });

const READ =
  "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} " +
  "AND TraceId = {traceId:String} {{idBound:stored_spans.TraceId:traceId}}";

/** A routed client over a driver: `ready` answers the marker row, `index` the index's bounds. */
function serverWith({
  ready,
  index = { n: 0, fromMs: 0, toMs: 0 },
  rows = [],
}: {
  ready: boolean;
  index?: { n: number; fromMs: number; toMs: number };
  rows?: unknown[];
}) {
  const execute = vi.fn<QueryDriver["execute"]>().mockImplementation(async (request) => {
    if (request.sql.includes("{marker:String}")) return { rows: ready ? [{ ready: 1 }] : [] };
    if (request.sql.startsWith("SELECT 1 AS found FROM ")) return { rows: [{ found: 1 }] };
    if (request.sql.includes("count() AS n")) {
      return {
        rows: [{ n: String(index.n), fromMs: String(index.fromMs), toMs: String(index.toMs) }],
      };
    }
    return { rows };
  });
  const client = new ClickHouseQueryClient({
    driver: { execute, insert: async () => {}, command: async () => {} },
    tenantGuard: new TenantGuard(),
  });
  client.declareIdIndexes({ indexes: [SPANS] });
  const sent = (): QueryRequest[] => execute.mock.calls.map(([request]) => request);
  const reads = () =>
    sent().filter(
      (request) => request.sql.startsWith("SELECT SpanId") || request.sql.includes("count() AS n"),
    );
  return { client, sent, reads };
}

let outcomes: { table: string; outcome: WindowedReadOutcome }[];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  outcomes = [];
  setWindowedReadMetrics({ record: (entry) => outcomes.push(entry) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a read carrying {{idBound}}", () => {
  describe("given the index is not ready on the tenant's target", () => {
    /** @scenario "until the backfill completes, a lookup keeps today's fallback" */
    it("expands the marker to nothing and runs today's read once", async () => {
      const server = serverWith({ ready: false });
      await server.client.idIndexes().check({ source: "stored_spans", target: "shared" });

      await server.client.query({
        tenantId: "p1",
        sql: READ,
        params: { tenantId: "p1", traceId: "t1" },
      });

      expect(server.reads().map((request) => request.sql)).toEqual([
        "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} " +
          "AND TraceId = {traceId:String} ",
      ]);
      expect(outcomes).toEqual([{ table: "stored_spans", outcome: "unwindowed" }]);
    });

    it("reads the caller's hinted window, then its fallback, as before the index", async () => {
      const server = serverWith({ ready: false });
      await server.client.idIndexes().check({ source: "stored_spans", target: "shared" });

      await server.client.query({
        tenantId: "p1",
        sql: READ,
        params: { tenantId: "p1", traceId: "t1" },
        idBound: { occurredAtHint: NOW, fallback: { lookbackMs: 7 * DAY } },
      });

      const windows = server.reads().map((request) => request.params);
      expect(windows).toMatchObject([
        { idBound_fromMs: NOW - 2 * DAY, idBound_toMs: NOW + 2 * DAY },
        { idBound_fromMs: NOW - 7 * DAY, idBound_toMs: NOW + 2 * DAY },
      ]);
      expect(outcomes).toEqual([{ table: "stored_spans", outcome: "widened_empty" }]);
    });
  });

  describe("given the index is ready", () => {
    /** @scenario "a lookup by id reads only the partitions the index names" */
    it("reads the index once, then the source within its range widened a day each side", async () => {
      const fromMs = NOW - 10 * DAY;
      const toMs = NOW - 9 * DAY;
      const server = serverWith({
        ready: true,
        index: { n: 1, fromMs, toMs },
        rows: [{ SpanId: "s1" }],
      });
      await server.client.idIndexes().check({ source: "stored_spans", target: "shared" });

      const { rows } = await server.client.query({
        tenantId: "p1",
        sql: READ,
        params: { tenantId: "p1", traceId: "t1" },
      });

      expect(rows).toEqual([{ SpanId: "s1" }]);
      const [lookup, read] = server.reads();
      expect(lookup?.sql).toContain(
        "FROM stored_spans_id_index WHERE TenantId = {tenantId:String}",
      );
      expect(lookup?.params).toMatchObject({ idIndexKey0: "t1" });
      expect(read?.sql).toContain(
        "AND StartTime >= fromUnixTimestamp64Milli({idBound_fromMs:Int64}) " +
          "AND StartTime <= fromUnixTimestamp64Milli({idBound_toMs:Int64})",
      );
      expect(read?.params).toMatchObject({
        idBound_fromMs: fromMs - ID_INDEX_WIDEN_MS,
        idBound_toMs: toMs + ID_INDEX_WIDEN_MS,
      });
      expect(outcomes).toEqual([{ table: "stored_spans", outcome: "index_hit" }]);
    });

    /** @scenario "an id the index has never seen probes recent data once and stops" */
    it("probes the recent 35 days once for an id the index has never seen", async () => {
      const server = serverWith({ ready: true });
      await server.client.idIndexes().check({ source: "stored_spans", target: "shared" });

      await server.client.query({
        tenantId: "p1",
        sql: READ,
        params: { tenantId: "p1", traceId: "t1" },
      });

      const [, probe] = server.reads();
      expect(probe?.params).toMatchObject({
        idBound_fromMs: NOW - RESOLVER_RECENT_WINDOW_MS,
        idBound_toMs: NOW + 2 * DAY,
      });
      expect(server.reads()).toHaveLength(2);
      expect(outcomes).toEqual([{ table: "stored_spans", outcome: "index_miss" }]);
    });

    it("reads a given time first and stops there when it finds rows", async () => {
      const server = serverWith({ ready: true, rows: [{ SpanId: "s1" }] });
      await server.client.idIndexes().check({ source: "stored_spans", target: "shared" });

      await server.client.query({
        tenantId: "p1",
        sql: READ,
        params: { tenantId: "p1", traceId: "t1" },
        idBound: { occurredAtHint: NOW },
      });

      expect(server.reads()).toHaveLength(1);
      expect(outcomes).toEqual([{ table: "stored_spans", outcome: "hit" }]);
    });

    /** @scenario "a read names its id and the reader adds the index bound" */
    it("bounds the aliased column where the marker names an alias", async () => {
      const server = serverWith({ ready: true, index: { n: 1, fromMs: NOW, toMs: NOW } });
      await server.client.idIndexes().check({ source: "stored_spans", target: "shared" });

      await server.client.query({
        tenantId: "p1",
        sql: READ.replace(
          "{{idBound:stored_spans.TraceId:traceId}}",
          "{{idBound:stored_spans.TraceId:traceId:s}}",
        ),
        params: { tenantId: "p1", traceId: "t1" },
      });

      expect(server.reads()[1]?.sql).toContain("AND s.StartTime >= ");
    });
  });

  describe("given the fenced reader with a shared grant", () => {
    it("reads the index under the fence's tenant set, so a shared project's id is found", async () => {
      const server = serverWith({ ready: true, index: { n: 1, fromMs: NOW, toMs: NOW } });
      await server.client.idIndexes().check({ source: "stored_spans", target: "shared" });
      const reader = new TenantScopedReader({
        client: async () => server.client,
        fence: { own: ["p1"], shared: [{ projectId: "p2", from: 0, until: null }] },
        tenantId: "p1",
      });

      await reader.query({
        query:
          "SELECT SpanId FROM stored_spans WHERE {{tenantScope:StartTime}} " +
          "AND TraceId = {traceId:String} {{idBound:stored_spans.TraceId:traceId}}",
        query_params: { traceId: "t1" },
      });

      const [lookup, read] = server.reads();
      expect(lookup?.sql).toContain("TenantId IN ({idBound_tenants:Array(String)})");
      expect(lookup?.params).toMatchObject({ idBound_tenants: ["p1", "p2"] });
      expect(lookup?.tenantIds).toEqual(["p1", "p2"]);
      expect(read?.params).toMatchObject({ idBound_fromMs: NOW - ID_INDEX_WIDEN_MS });
    });
  });

  describe("when the marker cannot be honoured", () => {
    const refusalOf = async (request: Pick<QueryRequest, "sql" | "params">) => {
      const server = serverWith({ ready: true });
      return server.client.query({ tenantId: "p1", ...request }).then(
        () => undefined,
        (error: unknown) => error,
      );
    };

    it("refuses a table that declares no id index", async () => {
      expect(
        await refusalOf({
          sql: READ.replaceAll("stored_spans.", "trace_summaries."),
          params: { tenantId: "p1", traceId: "t1" },
        }),
      ).toMatchObject({ violation: { kind: "unknown-id-index", table: "trace_summaries" } });
    });

    it("refuses a key that is not the index's", async () => {
      expect(
        await refusalOf({
          sql: READ.replace("stored_spans.TraceId", "stored_spans.SpanId"),
          params: { tenantId: "p1", traceId: "t1" },
        }),
      ).toMatchObject({ violation: { kind: "id-index-key-mismatch" } });
    });

    it("refuses an id parameter that is not bound to a string", async () => {
      expect(await refusalOf({ sql: READ, params: { tenantId: "p1" } })).toMatchObject({
        violation: { kind: "missing-id-param", param: "traceId" },
      });
    });

    it("refuses a caller parameter under the reserved prefix", async () => {
      expect(
        await refusalOf({ sql: READ, params: { tenantId: "p1", traceId: "t1", idBound_x: 1 } }),
      ).toMatchObject({ violation: { kind: "reserved-param", param: "idBound_x" } });
    });

    it("refuses markers for different ids in one statement", async () => {
      expect(
        await refusalOf({
          sql: `${READ} {{idBound:stored_spans.TraceId:otherId}}`,
          params: { tenantId: "p1", traceId: "t1", otherId: "t2" },
        }),
      ).toMatchObject({ violation: { kind: "mixed-id-bounds" } });
    });
  });
});

describe("defineIdIndex", () => {
  it("names the index after its source and copies the source's retention by default", () => {
    expect(SPANS).toEqual({
      source: "stored_spans",
      index: "stored_spans_id_index",
      key: ["TraceId"],
      time: "StartTime",
      retentionAnchor: "StartTime",
      retention: "copied",
    });
  });
});
