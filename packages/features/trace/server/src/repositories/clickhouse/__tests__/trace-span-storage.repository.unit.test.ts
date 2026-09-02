import { SecurityError } from "@langwatch/eventing";
import type { SpanInsertData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import type {
  TraceClickHouseWriteClient,
  TraceClickHouseWriteResolver,
} from "../../../ports/clickhouse.port";
import { TraceSpanStorageClickHouseRepository } from "../trace-span-storage.repository";

/**
 * Spec: packages/features/trace/specs/span-storage-write.feature
 *
 * TWIN-DRIFT PINS. The application's `SpanStorageClickHouseRepository` writes
 * the same `stored_spans` rows and does not compile against this file, so the
 * table name, the column set in the table's own order, the insert settings and
 * the retention stamp are pinned as literals here. They are a wire format
 * between two writers, and ClickHouse hides drift in it: an insert that omits a
 * column succeeds by filling in that column's default, and no reader can tell a
 * defaulted value from a written one.
 */
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

function repository(defaultRetentionDays = 49) {
  const clickhouse = new RecordingClickHouse();
  const repo = TraceSpanStorageClickHouseRepository.create({
    resolveClient: clickhouse.resolve,
    defaultRetentionDays,
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

describe("TraceSpanStorageClickHouseRepository", () => {
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
     * @scenario "A span without a retention of its own is stamped with the deployment's"
     */
    it("stamps the fallback on a span that declares none", async () => {
      const { clickhouse, repo } = repository(49);

      await repo.insertSpan({ ...span(), retentionDays: undefined as unknown as number });

      expect(clickhouse.rows()[0]?._retention_days).toBe(49);
    });

    /**
     * @scenario "A span that declares no retention at all is not silently kept forever"
     */
    it("keeps a declared zero rather than substituting the fallback", async () => {
      const { clickhouse, repo } = repository(49);

      await repo.insertSpan(span({ retentionDays: 0 }));

      expect(clickhouse.rows()[0]?._retention_days).toBe(0);
    });

    /**
     * @scenario "A span without a retention of its own is stamped with the deployment's"
     */
    it("keeps the span's own retention when it declares one", async () => {
      const { clickhouse, repo } = repository(49);

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
 *
 * Spec: specs/trace-processing/worker-trace-pipeline-conversion.feature
 *
 * These pins are not stylistic. The read backs a REDELIVERY path: the
 * coding-agent span-facts dispatcher is handed a span reference and has to
 * resolve it, and it re-runs on the queue's backoff until it can. Every literal
 * below is a way that loop turns from one cheap probe per retry into an
 * unbounded scan of every weekly partition, cold S3 tier included, per retry.
 */
class QueryingClickHouse {
  readonly queries: { query: string; params: Record<string, unknown>; settings?: unknown }[] = [];
  rows: Row[] = [];
  refuseWith: Error | null = null;

  readonly resolve: TraceClickHouseWriteResolver = async () => ({
    query: async (input) => {
      if (this.refuseWith) throw this.refuseWith;
      this.queries.push({
        query: input.query,
        params: input.query_params ?? {},
        settings: input.clickhouse_settings,
      });
      return { json: async () => this.rows as never[] };
    },
    insert: async () => undefined,
  });
}

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
  const repo = TraceSpanStorageClickHouseRepository.create({
    resolveClient: clickhouse.resolve,
    defaultRetentionDays: 49,
  });
  return { clickhouse, repo };
}

describe("TraceSpanStorageClickHouseRepository.findNormalizedSpanById", () => {
  describe("given a span reference with the span's own start time", () => {
    /** @scenario "The referenced span is read back inside its own partition window" */
    it("bounds the read to a window centred on the hint rather than scanning every partition", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      await repo.findNormalizedSpanById({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        occurredAtMs: 1_700_000_000_000,
      });

      expect(clickhouse.queries).toHaveLength(1);
      const [read] = clickhouse.queries;
      expect(read?.query).toContain("StartTime BETWEEN");
      expect(read?.params.fromMs).toBe(1_700_000_000_000 - 2 * 24 * 60 * 60 * 1000);
      expect(read?.params.toMs).toBe(1_700_000_000_000 + 2 * 24 * 60 * 60 * 1000);
    });

    /** @scenario "The referenced span is read back inside its own partition window" */
    it("pins the key triple so the read hits the primary key prefix", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      await repo.findNormalizedSpanById({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        occurredAtMs: 1_700_000_000_000,
      });

      const read = clickhouse.queries[0];
      expect(read?.query).toContain("TenantId = {tenantId:String}");
      expect(read?.query).toContain("TraceId = {traceId:String}");
      expect(read?.query).toContain("SpanId = {spanId:String}");
      expect(read?.params).toMatchObject({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
      });
    });

    /** @scenario "The derivation read never asks for the nested columns" */
    it("omits the Events and Links columns the derivation consumer never reads", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      const span = await repo.findNormalizedSpanById({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        occurredAtMs: 1_700_000_000_000,
      });

      const read = clickhouse.queries[0];
      expect(read?.query).not.toContain("Events.");
      expect(read?.query).not.toContain("Links.");
      expect(read?.query).toContain("SpanAttributes");
      expect(span?.events).toEqual([]);
      expect(span?.links).toEqual([]);
    });

    /** @scenario "The derivation read never asks for the nested columns" */
    it("keeps the lazy-materialization lock on the single-span fetch", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      await repo.findNormalizedSpanById({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        occurredAtMs: 1_700_000_000_000,
      });

      expect(clickhouse.queries[0]?.settings).toMatchObject({
        query_plan_optimize_lazy_materialization: "1",
      });
      expect(clickhouse.queries[0]?.query).toContain("ORDER BY UpdatedAt DESC");
      expect(clickhouse.queries[0]?.query).toContain("LIMIT 1");
    });

    /** @scenario "The referenced span is read back inside its own partition window" */
    it("maps the row onto the canonical span the derivation consumer expects", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.rows = [storedRow()];

      const span = await repo.findNormalizedSpanById({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        occurredAtMs: 1_700_000_000_000,
      });

      expect(span).toMatchObject({
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

      const span = await repo.findNormalizedSpanById({
        tenantId: "project-1",
        traceId: "trace-1",
        spanId: "span-1",
        occurredAtMs: 1_700_000_000_000,
      });

      expect(span).toBeNull();
      expect(clickhouse.queries).toHaveLength(1);
      expect(clickhouse.queries[0]?.query).toContain("StartTime BETWEEN");
    });
  });

  describe("given a read with no tenant", () => {
    /** @scenario "A tenantless read is refused before it reaches ClickHouse" */
    it("refuses before resolving a client", async () => {
      const { clickhouse, repo } = readRepository();

      await expect(
        repo.findNormalizedSpanById({
          tenantId: "",
          traceId: "trace-1",
          spanId: "span-1",
          occurredAtMs: 1_700_000_000_000,
        }),
      ).rejects.toThrow();
      expect(clickhouse.queries).toHaveLength(0);
    });
  });

  describe("given ClickHouse refuses the read", () => {
    /** @scenario "A refused read is reported rather than answered as absent" */
    it("lets the failure reach the caller so the queue redelivers", async () => {
      const { clickhouse, repo } = readRepository();
      clickhouse.refuseWith = new Error("Attempt to read after eof");

      await expect(
        repo.findNormalizedSpanById({
          tenantId: "project-1",
          traceId: "trace-1",
          spanId: "span-1",
          occurredAtMs: 1_700_000_000_000,
        }),
      ).rejects.toThrow("Attempt to read after eof");
    });
  });
});
