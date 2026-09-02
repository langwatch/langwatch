import { createTenantId } from "@langwatch/eventing";
import type { EventingClickHouseClient } from "@langwatch/eventing/server";
import {
  NormalizedSpanKind,
  type NormalizedSpan,
  type SpanInsertData,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import {
  createWorkerSpanStorage,
  createWorkerSpanStoragePort,
} from "../worker-span-storage.composition";

/**
 * Spec: packages/features/trace/specs/span-storage-write.feature
 *
 * A COMPOSITION-CAPABILITY test. Trace has not converted, so the application
 * still registers the span-storage projection and nothing in this process
 * writes a span. What has to be true today is that this composition root can
 * build the whole write path — projection store, port, repository, client —
 * from the tenant-keyed ClickHouse client and the retention default this
 * process already holds, and that a batch crossing it stays one insert.
 *
 * The fake client is typed as the Eventing substrate's own client, which is
 * what the process actually resolves. That the composition accepts it without
 * a cast is half of what this test proves: a write path that only compiled
 * against a driver client would be unbuildable here.
 */
type Insert = Parameters<EventingClickHouseClient["insert"]>[0];

class FakeEventingClickHouse {
  readonly resolvedTenants: string[] = [];
  readonly inserts: Insert[] = [];

  readonly resolve = async (tenantId: string): Promise<EventingClickHouseClient> => {
    this.resolvedTenants.push(tenantId);
    return {
      query: async () => ({ json: async () => [] }),
      insert: async (request) => {
        this.inserts.push(request);
        return undefined;
      },
    };
  };

  rows(at = 0): Record<string, unknown>[] {
    return (this.inserts[at]?.values ?? []) as Record<string, unknown>[];
  }
}

/** The projection-side span a consumer that is not a projection store hands the port. */
function spanInsertData(): SpanInsertData {
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
    endTimeUnixMs: 1_700_000_000_100,
    durationMs: 100,
    name: "llm call",
    kind: 3,
    resourceAttributes: {},
    spanAttributes: {},
    statusCode: null,
    statusMessage: null,
    instrumentationScope: { name: "langwatch" },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 0,
  };
}

function normalizedSpan(overrides: Partial<NormalizedSpan> = {}): NormalizedSpan {
  return {
    id: "projection-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "project-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1_700_000_000_000,
    endTimeUnixMs: 1_700_000_000_250,
    durationMs: 250,
    name: "llm call",
    kind: NormalizedSpanKind.CLIENT,
    resourceAttributes: { "service.name": "checkout" },
    spanAttributes: { "gen_ai.request.model": "gpt-5-mini" },
    events: [],
    links: [],
    statusMessage: null,
    statusCode: null,
    instrumentationScope: { name: "langwatch", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    ...overrides,
  };
}

describe("createWorkerSpanStorage", () => {
  describe("given the tenant-keyed ClickHouse client this process already holds", () => {
    /** @scenario "A background process can build the whole write path from what it holds" */
    it("stores a projected span as a stored span row", async () => {
      const clickhouse = new FakeEventingClickHouse();
      const store = createWorkerSpanStorage({
        resolveClickHouseClient: clickhouse.resolve,
        defaultRetentionDays: 49,
      });

      await store.append(normalizedSpan(), {
        aggregateId: "trace-1",
        tenantId: createTenantId("project-1"),
      });

      expect(clickhouse.inserts).toHaveLength(1);
      expect(clickhouse.inserts[0]?.table).toBe("stored_spans");
      expect(clickhouse.inserts[0]?.format).toBe("JSONEachRow");

      const row = clickhouse.rows()[0]!;
      expect(row.TenantId).toBe("project-1");
      expect(row.TraceId).toBe("trace-1");
      expect(row.SpanId).toBe("span-1");
      expect(row.StartTime).toEqual(new Date(1_700_000_000_000));
      expect(row.ServiceName).toBe("checkout");
    });

    /** @scenario "The batch is one insert, not one insert per span" */
    it("writes a bulk batch as one insert and resolves the tenant once", async () => {
      const clickhouse = new FakeEventingClickHouse();
      const store = createWorkerSpanStorage({
        resolveClickHouseClient: clickhouse.resolve,
        defaultRetentionDays: 49,
      });

      await store.bulkAppend(
        [
          normalizedSpan({ spanId: "span-1" }),
          normalizedSpan({ spanId: "span-2" }),
          normalizedSpan({ spanId: "span-3" }),
        ],
        { tenantId: createTenantId("project-1") },
      );

      expect(clickhouse.inserts).toHaveLength(1);
      expect(clickhouse.rows()).toHaveLength(3);
      expect(clickhouse.resolvedTenants).toEqual(["project-1"]);
    });

    /** @scenario "The tenant decides which ClickHouse the rows reach" */
    it("resolves the client for the tenant whose spans it is writing", async () => {
      const clickhouse = new FakeEventingClickHouse();
      const store = createWorkerSpanStorage({
        resolveClickHouseClient: clickhouse.resolve,
        defaultRetentionDays: 49,
      });

      await store.bulkAppend([normalizedSpan({ tenantId: "project-9" })], {
        tenantId: createTenantId("project-9"),
      });

      expect(clickhouse.resolvedTenants).toEqual(["project-9"]);
      expect(clickhouse.rows()[0]?.TenantId).toBe("project-9");
    });

    /**
     * @scenario "A background process can build the whole write path from what it holds"
     */
    it("stamps the retention this process was configured with", async () => {
      const clickhouse = new FakeEventingClickHouse();
      const store = createWorkerSpanStorage({
        resolveClickHouseClient: clickhouse.resolve,
        defaultRetentionDays: 49,
      });

      await store.append(normalizedSpan(), {
        aggregateId: "trace-1",
        tenantId: createTenantId("project-1"),
      });

      expect(clickhouse.rows()[0]?._retention_days).toBe(49);
    });

    /**
     * @scenario "A span without a retention of its own is stamped with the deployment's"
     */
    it("prefers the tenant's own resolved retention over the process default", async () => {
      const clickhouse = new FakeEventingClickHouse();
      const store = createWorkerSpanStorage({
        resolveClickHouseClient: clickhouse.resolve,
        defaultRetentionDays: 49,
      });

      await store.append(normalizedSpan(), {
        aggregateId: "trace-1",
        tenantId: createTenantId("project-1"),
        retentionPolicy: { traces: 7 },
      });

      expect(clickhouse.rows()[0]?._retention_days).toBe(7);
    });
  });

  describe("given a consumer that wants the write capability without a projection store", () => {
    /**
     * The projection store always stamps a retention onto the record it hands
     * down, so the port's own fallback is unreachable through it. A consumer
     * that is not a projection store — the trace conversion will have one —
     * reaches it on every span, which is why the fallback is pinned HERE and
     * not only on the store path: a composition that ignored the retention it
     * was handed would write `_retention_days: 0` and expire the rows today.
     */
    /** @scenario "A span without a retention of its own is stamped with the deployment's" */
    it("stamps the retention this process was configured with on a span that declares none", async () => {
      const clickhouse = new FakeEventingClickHouse();
      const spans = createWorkerSpanStoragePort({
        resolveClickHouseClient: clickhouse.resolve,
        defaultRetentionDays: 49,
      });

      await spans.insertSpan({
        ...spanInsertData(),
        retentionDays: undefined as unknown as number,
      });

      expect(clickhouse.rows()[0]?._retention_days).toBe(49);
    });

    /** @scenario "A background process can build the whole write path from what it holds" */
    it("builds the span-storage port from the same two substrates", async () => {
      const clickhouse = new FakeEventingClickHouse();
      const spans = createWorkerSpanStoragePort({
        resolveClickHouseClient: clickhouse.resolve,
        defaultRetentionDays: 49,
      });

      await spans.insertSpans([{ ...spanInsertData(), retentionDays: 35 }]);

      expect(clickhouse.inserts).toHaveLength(1);
      expect(clickhouse.rows()[0]?._retention_days).toBe(35);
    });
  });
});
