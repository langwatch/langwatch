import type { SpanInsertData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";
import type {
  TraceClickHouseWriteClient,
  TraceClickHouseWriteResolver,
} from "../../ports/clickhouse.port";
import { TraceSpanStoragePort } from "../../ports/trace-span-storage.port";
import { ClickHouseTraceSpanStorageAdapter } from "../clickhouse.trace-span-storage.adapter";

/**
 * Spec: packages/features/trace/specs/span-storage-write.feature
 *
 * The adapter is the seam a process composes, so what it has to prove is that
 * it IS the port the span-storage store consumes and that the batch survives
 * the crossing. An adapter that fanned a batch out into one call per span
 * would satisfy every type in sight and quietly multiply the ingestion path's
 * round trips by the batch size.
 */
type Insert = Parameters<TraceClickHouseWriteClient["insert"]>[0];

function adapter(defaultRetentionDays = 49) {
  const inserts: Insert[] = [];
  const resolvedTenants: string[] = [];
  const resolveClient: TraceClickHouseWriteResolver = async (tenantId) => {
    resolvedTenants.push(tenantId);
    return {
      query: async () => ({ json: async () => [] }),
      insert: async (input) => {
        inserts.push(input);
        return undefined;
      },
    };
  };

  return {
    inserts,
    resolvedTenants,
    port: ClickHouseTraceSpanStorageAdapter.create({ resolveClient, defaultRetentionDays }),
  };
}

function span(spanId: string): SpanInsertData {
  return {
    id: `projection-${spanId}`,
    tenantId: "project-1",
    traceId: "trace-1",
    spanId,
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

describe("ClickHouseTraceSpanStorageAdapter", () => {
  describe("given a tenant-keyed ClickHouse client", () => {
    /** @scenario "A background process can build the whole write path from what it holds" */
    it("is the span-storage port the store consumes", () => {
      expect(adapter().port).toBeInstanceOf(TraceSpanStoragePort);
    });

    /** @scenario "The batch is one insert, not one insert per span" */
    it("carries a batch across as one insert rather than one per span", async () => {
      const { port, inserts, resolvedTenants } = adapter();

      await port.insertSpans([span("a"), span("b"), span("c")]);

      expect(inserts).toHaveLength(1);
      expect(inserts[0]?.values).toHaveLength(3);
      expect(resolvedTenants).toEqual(["project-1"]);
    });

    /** @scenario "A span without a retention of its own is stamped with the deployment's" */
    it("stamps the retention the process configured it with", async () => {
      const { port, inserts } = adapter(35);

      await port.insertSpan({ ...span("a"), retentionDays: undefined as unknown as number });

      const row = (inserts[0]!.values as Record<string, unknown>[])[0]!;
      expect(row._retention_days).toBe(35);
    });
  });
});
