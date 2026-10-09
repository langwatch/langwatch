import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { QueryRequest, QueryResult } from "@langwatch/clickhouse-client";
import { createTenantId, SecurityError } from "@langwatch/eventing";
import type { SpanInsertData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createTestSpan } from "../../../eventing/__tests__/trace-summary-test.fixtures.ts";
import { SpanStorageStore } from "../../../eventing/span-storage.store.ts";
import {
  AuthorizedTraceReadsRepository,
  type TraceClickHouseWriteClient,
  type TraceClickHouseWriteResolver,
} from "../clickhouse.trace-member-client.repository.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";
import { recordingAuthorizedReads } from "./support/authorized-reads.support.ts";

/** TWIN-DRIFT PINS: table name, column set, insert settings and retention
 * stamp are pinned as literals. An insert that omits a column succeeds by
 * filling in the default; no reader can tell. Spec: span-storage-write.feature */
const STORED_SPANS_TABLE = "stored_spans";

const STORED_SPAN_COLUMNS = [
  "ProjectionId",
  "TenantId",
  "TraceId",
  "SpanId",
  "ParentSpanId",
  "ParentTraceId",
  "ParentIsRemote",
  "Sampled",
  "StartTime",
  "EndTime",
  "DurationMs",
  "SpanName",
  "SpanKind",
  "ServiceName",
  "ResourceAttributes",
  "SpanAttributes",
  "StatusCode",
  "StatusMessage",
  "ScopeName",
  "ScopeVersion",
  "Events.Timestamp",
  "Events.Name",
  "Events.Attributes",
  "Links.TraceId",
  "Links.SpanId",
  "Links.Attributes",
  "DroppedAttributesCount",
  "DroppedEventsCount",
  "DroppedLinksCount",
  "Cost",
  "NonBilledCost",
  "CreatedAt",
  "UpdatedAt",
  "_retention_days",
];

const STORED_SPAN_INSERT_SETTINGS = {
  async_insert: 1,
  wait_for_async_insert: 1,
  input_format_json_throw_on_bad_escape_sequence: 0,
};

type Insert = Parameters<TraceClickHouseWriteClient["insert"]>[0];
type Row = Record<string, unknown>;

class RecordingClickHouse {
  readonly resolvedTenants: string[] = [];
  readonly inserts: Insert[] = [];
  refuseWith: Error | null = null;

  readonly resolve: TraceClickHouseWriteResolver = async (tenantId) => {
    this.resolvedTenants.push(tenantId);
    return {
      query: async () => ({ json: async () => [] }),
      insert: async (input) => {
        if (this.refuseWith) throw this.refuseWith;
        this.inserts.push(input);
        return undefined;
      },
    };
  };

  rows(at = 0): Row[] {
    return (this.inserts[at]?.values ?? []) as Row[];
  }
}

function repository() {
  const clickhouse = new RecordingClickHouse();
  const repo = SpanStorageClickHouseRepository.create({
    resolveClient: clickhouse.resolve,
    reads: recordingAuthorizedReads().reads,
  });
  return { clickhouse, repo };
}

function span(overrides: Partial<SpanInsertData> = {}): SpanInsertData {
  return {
    id: "projection-1",
    tenantId: "project-1",
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1_700_000_000_000,
    endTimeUnixMs: 1_700_000_000_250,
    durationMs: 250.4,
    name: "llm call",
    kind: 3,
    resourceAttributes: {},
    spanAttributes: {},
    statusCode: null,
    statusMessage: null,
    instrumentationScope: { name: "langwatch", version: "1.2.3" },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 7,
    ...overrides,
  };
}

describe("SpanStorageClickHouseRepository", () => {
  describe("given a batch of spans for one tenant", () => {
    /** @scenario "The batch is one insert, not one insert per span" */
    it("issues a single insert carrying every span rather than one per span", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpans([
        span({ spanId: "span-1" }),
        span({ spanId: "span-2" }),
        span({ spanId: "span-3" }),
      ]);

      expect(clickhouse.inserts).toHaveLength(1);
      expect(clickhouse.rows()).toHaveLength(3);
      expect(clickhouse.rows().map((row) => row.SpanId)).toEqual(["span-1", "span-2", "span-3"]);
    });

    /** @scenario "The batch is one insert, not one insert per span" */
    it("resolves the tenant's client once for the whole batch", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpans([span({ spanId: "a" }), span({ spanId: "b" })]);

      expect(clickhouse.resolvedTenants).toEqual(["project-1"]);
    });

    /** @scenario "The tenant decides which ClickHouse the rows reach" */
    it("resolves the client for the batch's own tenant", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpans([span({ tenantId: "project-9" })]);

      expect(clickhouse.resolvedTenants).toEqual(["project-9"]);
    });
  });

  describe("given a batch whose spans name two tenants", () => {
    /** @scenario "A batch may not mix tenants" */
    it("refuses the write as a security violation", async () => {
      const { repo } = repository();

      await expect(
        repo.insertSpans([span({ tenantId: "project-1" }), span({ tenantId: "project-2" })]),
      ).rejects.toBeInstanceOf(SecurityError);
    });

    /** @scenario "A batch may not mix tenants" */
    it("resolves no client and writes nothing", async () => {
      const { clickhouse, repo } = repository();

      await expect(
        repo.insertSpans([span({ tenantId: "project-1" }), span({ tenantId: "project-2" })]),
      ).rejects.toBeInstanceOf(SecurityError);

      expect(clickhouse.resolvedTenants).toEqual([]);
      expect(clickhouse.inserts).toEqual([]);
    });
  });

  describe("given an empty batch", () => {
    /** @scenario "An empty batch touches nothing" */
    it("resolves no client and writes nothing", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpans([]);

      expect(clickhouse.resolvedTenants).toEqual([]);
      expect(clickhouse.inserts).toEqual([]);
    });
  });

  describe("given one span", () => {
    /** @scenario "The rows carry the columns the table declares" */
    it("writes exactly the stored span columns, in the table's own order", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span());

      expect(Object.keys(clickhouse.rows()[0]!)).toEqual(STORED_SPAN_COLUMNS);
    });

    /** @scenario "The rows carry the columns the table declares" */
    it("writes to the stored spans table as JSON-each-row", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span());

      expect(clickhouse.inserts[0]?.table).toBe(STORED_SPANS_TABLE);
      expect(clickhouse.inserts[0]?.format).toBe("JSONEachRow");
    });

    /**
     * @scenario "The insert tolerates a lone surrogate rather than dead-lettering the span"
     */
    it("asks ClickHouse to keep a bad escape sequence instead of failing the insert", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span());

      expect(clickhouse.inserts[0]?.clickhouse_settings).toEqual(STORED_SPAN_INSERT_SETTINGS);
      expect(
        clickhouse.inserts[0]?.clickhouse_settings?.input_format_json_throw_on_bad_escape_sequence,
      ).toBe(0);
    });

    /**
     * @scenario "The insert tolerates a lone surrogate rather than dead-lettering the span"
     */
    it("waits for the asynchronous insert so a failure is the caller's to retry", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span());

      expect(clickhouse.inserts[0]?.clickhouse_settings?.async_insert).toBe(1);
      expect(clickhouse.inserts[0]?.clickhouse_settings?.wait_for_async_insert).toBe(1);
    });

    /** @scenario "The version column is the span's own start" */
    it("stamps the row's start and end from the span's own times", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(
        span({ startTimeUnixMs: 1_699_999_000_000, endTimeUnixMs: 1_699_999_500_000 }),
      );

      const row = clickhouse.rows()[0]!;
      expect(row.StartTime).toEqual(new Date(1_699_999_000_000));
      expect(row.EndTime).toEqual(new Date(1_699_999_500_000));
    });

    /** @scenario "The version column is the span's own start" */
    it("keeps the deduplication key triple on the row", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span({ tenantId: "p-7", traceId: "t-7", spanId: "s-7" }));

      const row = clickhouse.rows()[0]!;
      expect([row.TenantId, row.TraceId, row.SpanId]).toEqual(["p-7", "t-7", "s-7"]);
    });

    /** @scenario "The dropped counts are the table's, not the span's" */
    it("writes zero dropped counts even when the span reports its own", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(
        span({ droppedAttributesCount: 5, droppedEventsCount: 6, droppedLinksCount: 7 }),
      );

      const row = clickhouse.rows()[0]!;
      expect(row.DroppedAttributesCount).toBe(0);
      expect(row.DroppedEventsCount).toBe(0);
      expect(row.DroppedLinksCount).toBe(0);
    });

    /** @scenario "Attribute values reach ClickHouse as strings" */
    it("serializes every attribute value to a string", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(
        span({
          spanAttributes: { count: 3, ok: true, nested: { a: 1 } },
          resourceAttributes: { list: [1, 2] },
          events: [{ name: "e", timeUnixMs: 1, attributes: { n: 4 } }],
          links: [{ traceId: "t", spanId: "s", attributes: { m: false } }],
        }),
      );

      const row = clickhouse.rows()[0]!;
      expect(row.SpanAttributes).toEqual({ count: "3", ok: "true", nested: '{"a":1}' });
      expect(row.ResourceAttributes).toEqual({ list: "[1,2]" });
      expect((row["Events.Attributes"] as unknown[])[0]).toEqual({ n: "4" });
      expect((row["Links.Attributes"] as unknown[])[0]).toEqual({ m: "false" });
    });

    /** @scenario "The service name prefers the span's own attribute" */
    it("takes the span's service name over the resource's", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(
        span({
          spanAttributes: { "service.name": "from-span" },
          resourceAttributes: { "service.name": "from-resource" },
        }),
      );

      expect(clickhouse.rows()[0]?.ServiceName).toBe("from-span");
    });

    /** @scenario "The service name prefers the span's own attribute" */
    it("falls back to the resource, then to an unknown service", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span({ resourceAttributes: { "service.name": "from-resource" } }));
      await repo.insertSpan(span());

      expect(clickhouse.rows(0)[0]?.ServiceName).toBe("from-resource");
      expect(clickhouse.rows(1)[0]?.ServiceName).toBe("unknown");
    });

    /** @scenario "The rows carry the columns the table declares" */
    it("rounds the duration the table stores as a whole millisecond", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span({ durationMs: 250.6 }));

      expect(clickhouse.rows()[0]?.DurationMs).toBe(251);
    });
  });

  describe("given a retention fallback the process was configured with", () => {
    /**
     * @scenario "A background process can build the whole write path from what it holds"
     * @scenario "A span without a retention of its own is stamped with the deployment's"
     */
    it("stamps the fallback on a span that declares none", async () => {
      const { clickhouse, repo } = repository();
      const store = SpanStorageStore.create({ storage: repo, defaultRetentionDays: () => 49 });

      await store.append(createTestSpan({}), {
        aggregateId: "trace-1",
        tenantId: createTenantId("project-1"),
      });

      expect(clickhouse.rows()[0]?._retention_days).toBe(49);
    });

    /**
     * @scenario "A span that declares no retention at all is not silently kept forever"
     */
    it("keeps a declared zero rather than substituting the fallback", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span({ retentionDays: 0 }));

      expect(clickhouse.rows()[0]?._retention_days).toBe(0);
    });

    /**
     * @scenario "A span without a retention of its own is stamped with the deployment's"
     */
    it("keeps the span's own retention when it declares one", async () => {
      const { clickhouse, repo } = repository();

      await repo.insertSpan(span({ retentionDays: 7 }));

      expect(clickhouse.rows()[0]?._retention_days).toBe(7);
    });
  });

  describe("given a ClickHouse that refuses the insert", () => {
    /** @scenario "A refused insert is reported rather than swallowed" */
    it("lets the failure reach the caller so the queue can retry it", async () => {
      const { clickhouse, repo } = repository();
      clickhouse.refuseWith = new Error("TOO_MANY_PARTS");

      await expect(repo.insertSpans([span()])).rejects.toThrow("TOO_MANY_PARTS");
      await expect(repo.insertSpan(span())).rejects.toThrow("TOO_MANY_PARTS");
    });
  });
});

/**
 * The read half, harvested at the conversion.
 * Spec: specs/trace-processing/worker-trace-pipeline-conversion.feature
 */
/** The routed member behind the proof-checking reader: records each expanded statement. */
class QueryingClickHouse {
  readonly queries: QueryRequest[] = [];
  rows: Row[] = [];
  refuseWith: Error | null = null;

  readonly query = async <R>(request: QueryRequest): Promise<QueryResult<R>> => {
    if (this.refuseWith) throw this.refuseWith;
    this.queries.push(request);
    return { rows: this.rows as R[] };
  };
}

/** Writes are refused here: the read half never resolves a tenant's own client. */
const refusingResolver: TraceClickHouseWriteResolver = async () => {
  throw new Error("a read must not resolve a tenant's own client");
};

const NOW = Date.now();
const proofFor = (projectId: string) => ownProof({ projectId, now: NOW });

function storedRow(overrides: Record<string, unknown> = {}): Row {
  return {
    SpanId: "span-1",
    TraceId: "trace-1",
    TenantId: "project-1",
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: true,
    StartTimeMs: 1_700_000_000_000,
    EndTimeMs: 1_700_000_000_250,
    DurationMs: 250,
    SpanName: "session_task.turn",
    SpanKind: 1,
    ResourceAttributes: {},
    SpanAttributes: { "gen_ai.request.model": "gpt-5-mini" },
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "codex",
    ScopeVersion: null,
    Cost: 0.25,
    NonBilledCost: null,
    ...overrides,
  };
}

function readRepository() {
  const clickhouse = new QueryingClickHouse();
  const repo = SpanStorageClickHouseRepository.create({
    resolveClient: refusingResolver,
    reads: AuthorizedTraceReadsRepository.create({ clickhouse }),
  });
  return { clickhouse, repo };
}

describe("SpanStorageClickHouseRepository.findNormalizedSpanById", () => {
  const byId = () => ({
    authorization: proofFor("project-1"),
    traceId: "trace-1",
    spanId: "span-1",
    occurredAtMs: 1_700_000_000_000,
  });

  describe("given a span reference with the span's own start time", () => {
    /** @scenario "The referenced span is read back inside its own partition window" */
    it("bounds the read to a window centred on the hint rather than scanning every partition", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      await repo.findNormalizedSpanById(byId());

      expect(clickhouse.queries).toHaveLength(1);
      const [read] = clickhouse.queries;
      expect(read?.sql).toContain("StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})");
      expect(read?.params?.fromMs).toBe(1_700_000_000_000 - 2 * 24 * 60 * 60 * 1000);
      expect(read?.params?.toMs).toBe(1_700_000_000_000 + 2 * 24 * 60 * 60 * 1000);
    });

    /** @scenario "The referenced span is read back inside its own partition window" */
    it("pins the key triple so the read hits the primary key prefix", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      await repo.findNormalizedSpanById(byId());

      const read = clickhouse.queries[0];
      expect(read?.sql).toContain("TenantId IN ({tenantScope_all:Array(String)})");
      expect(read?.sql).toContain("TraceId = {traceId:String}");
      expect(read?.sql).toContain("SpanId = {spanId:String}");
      expect(read?.tenantId).toBe("project-1");
      expect(read?.params).toMatchObject({
        tenantScope_all: ["project-1"],
        traceId: "trace-1",
        spanId: "span-1",
      });
    });

    /** @scenario "The derivation read never asks for the nested columns" */
    it("omits the Events and Links columns the derivation consumer never reads", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      const foundSpan = await repo.findNormalizedSpanById(byId());

      const read = clickhouse.queries[0];
      expect(read?.sql).not.toContain("Events.");
      expect(read?.sql).not.toContain("Links.");
      expect(read?.sql).toContain("SpanAttributes");
      expect(foundSpan?.events).toEqual([]);
      expect(foundSpan?.links).toEqual([]);
    });

    /** @scenario "The derivation read never asks for the nested columns" */
    it("keeps the lazy-materialization lock on the single-span fetch", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      await repo.findNormalizedSpanById(byId());

      expect(clickhouse.queries[0]?.settings).toMatchObject({
        query_plan_optimize_lazy_materialization: "1",
      });
      expect(clickhouse.queries[0]?.sql).toContain("ORDER BY UpdatedAt DESC");
      expect(clickhouse.queries[0]?.sql).toContain("LIMIT 1");
    });

    /** @scenario "The referenced span is read back inside its own partition window" */
    it("maps the row onto the canonical span the derivation consumer expects", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      const foundSpan = await repo.findNormalizedSpanById(byId());

      expect(foundSpan).toMatchObject({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        name: "session_task.turn",
        cost: 0.25,
        spanAttributes: { "gen_ai.request.model": "gpt-5-mini" },
      });
    });
  });

  describe("given the span has not landed inside its window yet", () => {
    /** @scenario "A span that has not landed is a miss, not an unbounded scan" */
    it("answers absent after exactly one probe rather than widening to every partition", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [];

      const foundSpan = await repo.findNormalizedSpanById(byId());

      expect(foundSpan).toBeNull();
      expect(clickhouse.queries).toHaveLength(1);
      expect(clickhouse.queries[0]?.sql).toContain(
        "StartTime >= fromUnixTimestamp64Milli({fromMs:Int64})",
      );
    });
  });

  describe("given a read whose proof has expired", () => {
    /** @scenario "A tenantless read is refused before it reaches ClickHouse" */
    it("refuses before reaching ClickHouse", async () => {
      const { clickhouse, repo } = readRepository();

      await expect(
        repo.findNormalizedSpanById({
          ...byId(),
          authorization: ownProof({ projectId: "project-1", now: 0 }),
        }),
      ).rejects.toMatchObject({ code: "authorization_expired" });
      expect(clickhouse.queries).toHaveLength(0);
    });
  });

  describe("given ClickHouse refuses the read", () => {
    /** @scenario "A refused read is reported rather than answered as absent" */
    it("lets the failure reach the caller so the queue redelivers", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.refuseWith = new Error("Attempt to read after eof");

      await expect(repo.findNormalizedSpanById(byId())).rejects.toThrow(
        "Attempt to read after eof",
      );
    });
  });
});

/** ADR-175: every read is fenced by the proof the caller hands it, never by a tenant it names. */
describe("SpanStorageClickHouseRepository reads through the proof", () => {
  const authorization = proofFor("project-1");
  const byTrace = { authorization, traceId: "trace-1", occurredAtMs: 1_700_000_000_000 };
  const rollupRead = (repo: SpanStorageClickHouseRepository) =>
    repo.findTraceEventRollupsByTraceIds({
      authorization,
      traceIds: ["trace-1"],
      timeRange: { from: 1_700_000_000_000, to: 1_700_000_060_000 },
    });
  const modelSampleRead = (repo: SpanStorageClickHouseRepository) =>
    repo.findRecentSpansByModels({
      authorization,
      models: ["gpt-5-mini"],
      fromMs: 1_700_000_000_000,
      perModelLimit: 3,
      limit: 10,
    });
  const reads: Record<string, (repo: SpanStorageClickHouseRepository) => Promise<unknown>> = {
    findSpansByTraceId: (repo) => repo.findSpansByTraceId(byTrace),
    findNormalizedSpansByTraceId: (repo) => repo.findNormalizedSpansByTraceId(byTrace),
    findSpanByIds: (repo) => repo.findSpanByIds({ ...byTrace, spanId: "span-1" }),
    findTraceEventsByTraceId: (repo) => repo.findTraceEventsByTraceId(byTrace),
    findTraceEventRollupsByTraceIds: rollupRead,
    findEventsByTraceId: (repo) => repo.findEventsByTraceId(byTrace),
    findSpanEvents: (repo) => repo.findSpanEvents({ ...byTrace, spanId: "span-1" }),
    findSpanSummaryByTraceId: (repo) => repo.findSpanSummaryByTraceId(byTrace),
    findLangwatchSignalsByTraceId: (repo) => repo.findLangwatchSignalsByTraceId(byTrace),
    findSpanResourcesByTraceId: (repo) => repo.findSpanResourcesByTraceId(byTrace),
    listSpansPaginated: (repo) => repo.listSpansPaginated({ ...byTrace, limit: 10, offset: 0 }),
    findSpansSince: (repo) => repo.findSpansSince({ ...byTrace, sinceStartTimeMs: 0 }),
    findModelUsageStats: (repo) =>
      repo.findModelUsageStats({ authorization, fromMs: 1_700_000_000_000, limit: 10 }),
    findRecentSpansByModels: modelSampleRead,
    hintlessTraceRead: (repo) =>
      repo.findSpanSummaryByTraceId({ authorization, traceId: "trace-1" }),
  };

  describe.each(Object.entries(reads))("given %s", (_name, read) => {
    it("sends every statement fenced to the proof's tenant and names none of its own", async () => {
      const { clickhouse, repo } = readRepository();

      await read(repo);

      expect(clickhouse.queries.length).toBeGreaterThan(0);
      for (const sent of clickhouse.queries) {
        expect(sent.sql).toContain("TenantId IN ({tenantScope_all:Array(String)})");
        expect(sent.sql).not.toContain("{tenantId:String}");
        expect(sent.params).not.toHaveProperty("tenantId");
        expect(sent.params?.tenantScope_all).toEqual(["project-1"]);
        expect(sent.tenantId).toBe("project-1");
      }
    });
  });

  describe("given a proof that also reads a member project inside its grant's window", () => {
    it("sends the statement under both tenants with the member's window bound", async () => {
      const { clickhouse, repo } = readRepository();
      const aggregate = aggregateProof({
        projectId: "aggregate-1",
        members: [{ projectId: "member-1", from: 1_600_000_000_000 }],
        now: NOW,
      });

      await repo.findSpansByTraceId({ ...byTrace, authorization: aggregate });

      const [sent] = clickhouse.queries;
      expect(sent?.tenantIds).toEqual(["aggregate-1", "member-1"]);
      expect(sent?.params).toMatchObject({
        tenantScope_all: ["aggregate-1", "member-1"],
        tenantScope_ids: ["member-1"],
        tenantScope_from: [1_600_000_000_000],
      });
    });
  });

  describe("given a page of traces two tenants may share an id across", () => {
    it("groups, ranks and trims the event rollup per tenant as well as per trace", async () => {
      const { clickhouse, repo } = readRepository();

      await rollupRead(repo);

      const sql = clickhouse.queries[0]?.sql ?? "";
      expect(sql).toMatch(/GROUP BY tenantId, traceId, name/);
      expect(sql).toMatch(/PARTITION BY tenantId, traceId/);
      expect(sql).toMatch(/LIMIT \{maxNames:UInt32\} BY tenantId, traceId/);
    });
  });

  describe("given the model sample read over the trace summaries and the spans", () => {
    it("fences the candidate traces on their occurrence and the spans on their start", async () => {
      const { clickhouse, repo } = readRepository();

      await modelSampleRead(repo);

      const sql = clickhouse.queries[0]?.sql ?? "";
      expect(sql.match(/TenantId IN \(\{tenantScope_all:Array\(String\)\}\)/g)).toHaveLength(2);
    });
  });
});
