import { describe, expect, it } from "vitest";
import { createTraceProcessingPipeline } from "~/server/event-sourcing/trace-processing";
import { createFakeClient } from "~/server/event-sourcing/trace-processing/__tests__/fixtures";
import {
  storedSpansTable,
  traceAnalyticsTable,
  traceSummariesTable,
} from "~/server/event-sourcing/trace-processing/table";
import {
  CanonicalizeSpanAttributesService,
  canonicalizeSpan,
} from "../canonicalisation";
import { spanSchema } from "../ingest/otlp";
import { SpanNormalizationPipelineService } from "../span-normalization.service";

/**
 * The span-ingest seam, end to end over the real pipeline: an OTLP envelope in
 * exactly the shape `event_log` was carrying — protobuf `Long` timestamps, a
 * numeric `kind`, `KeyValue` attributes — reaches the `recordSpan` command as a
 * `CanonicalSpan` and comes out the other side as read-model rows.
 *
 * Trace ingest was silently lost because the envelope was handed to the command
 * verbatim. The command's id resolver is `(d) => d.traceId`, and the envelope
 * carries the trace id at `d.span.traceId`, so every event committed with an
 * empty `AggregateId` and neither aggregate-scoped fold could key a row. The
 * first case here executes that failure rather than asserting on its shape.
 */

const SPAN_RECEIVED = "lw.obs.trace.span_received";
const TENANT_ID = "local-dev-project";
const TRACE_ID = "5afd4fa2030c898be40aa16645a652e0";
const SPAN_ID = "21a94d346206ed31";
const START_MS = 1_700_000_000_000;

/** Protobuf carries a fixed64 as a `{ low, high }` pair, `low` signed. */
function long(nanos: bigint): { low: number; high: number } {
  return {
    low: Number(BigInt.asIntN(32, nanos & 0xffffffffn)),
    high: Number(nanos >> 32n),
  };
}

function stringAttribute(key: string, value: string) {
  return {
    key,
    value: {
      stringValue: value,
      boolValue: null,
      intValue: null,
      doubleValue: null,
      arrayValue: null,
      kvlistValue: null,
      bytesValue: null,
    },
  };
}

/** The envelope as `TraceRequestCollectionService` assembles it. */
function otlpEnvelope() {
  return {
    tenantId: TENANT_ID,
    span: spanSchema.parse({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceState: null,
      parentSpanId: null,
      name: "chat-completion",
      kind: 1,
      startTimeUnixNano: long(BigInt(START_MS) * 1_000_000n),
      endTimeUnixNano: long(BigInt(START_MS + 500) * 1_000_000n),
      attributes: [
        stringAttribute("langwatch.span.type", "llm"),
        stringAttribute("gen_ai.response.model", "gpt-5-mini"),
        stringAttribute(
          "langwatch.input",
          '{"type":"text","value":"Hello, how are you?"}',
        ),
      ],
      events: [],
      links: [],
      status: { code: 1, message: null },
    }),
    resource: { attributes: [stringAttribute("service.name", "checkout")] },
    instrumentationScope: { name: "langwatch", version: "1.0.0" },
    occurredAt: START_MS,
  };
}

function canonicalizeEnvelope() {
  const envelope = otlpEnvelope();
  const normalization = new SpanNormalizationPipelineService(
    new CanonicalizeSpanAttributesService(),
  );
  return canonicalizeSpan({
    normalized: normalization.normalizeSpanReceived(
      envelope.tenantId,
      envelope.span,
      envelope.resource,
      envelope.instrumentationScope,
    ),
    piiRedactionLevel: "ESSENTIAL",
    occurredAt: envelope.occurredAt,
    acceptedAt: START_MS + 10,
  });
}

describe("given an OTLP span envelope arriving at the recordSpan seam", () => {
  describe("when the envelope is handed to the command uncanonicalised", () => {
    it("resolves no aggregate id, which is what stranded every trace", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      const aggregateId = built.aggregateIdFor(SPAN_RECEIVED, otlpEnvelope());

      expect(aggregateId).toBeFalsy();
      expect(aggregateId).not.toBe(TRACE_ID);
    });
  });

  describe("when the envelope is canonicalised first", () => {
    it("resolves the aggregate id the folds key their rows on", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      expect(built.aggregateIdFor(SPAN_RECEIVED, canonicalizeEnvelope())).toBe(
        TRACE_ID,
      );
    });

    it("decodes the protobuf timestamps into unix milliseconds", () => {
      const span = canonicalizeEnvelope();

      expect(span.startTimeUnixMs).toBe(START_MS);
      expect(span.endTimeUnixMs).toBe(START_MS + 500);
    });

    it("flattens the KeyValue attributes the fold reads by name", () => {
      const span = canonicalizeEnvelope();

      expect(span.spanType).toBe("llm");
      expect(span.model).toBe("gpt-5-mini");
      expect(span.resourceAttributes["service.name"]).toBe("checkout");
    });

    it("passes the command's own input schema", () => {
      const built = createTraceProcessingPipeline({
        client: createFakeClient(),
      });

      expect(() =>
        built.commands.recordSpan!.input.parse(canonicalizeEnvelope()),
      ).not.toThrow();
    });
  });

  describe("when the canonicalised span is folded", () => {
    it("writes a trace summary row", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.folds.traceSummary!.apply({
        key: TRACE_ID,
        tenantId: TENANT_ID,
        events: [{ type: SPAN_RECEIVED, data: canonicalizeEnvelope() }],
      });

      expect(result).toEqual({ events: 1 });
      expect(client.insertCalls[0]?.table).toBe(traceSummariesTable.name);
    });

    it("writes a trace analytics row", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.folds.traceAnalytics!.apply({
        key: TRACE_ID,
        tenantId: TENANT_ID,
        events: [{ type: SPAN_RECEIVED, data: canonicalizeEnvelope() }],
      });

      expect(result).toEqual({ events: 1 });
      expect(client.insertCalls[0]?.table).toBe(traceAnalyticsTable.name);
    });

    it("carries the span's name and model into the summary row", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      await built.folds.traceSummary!.apply({
        key: TRACE_ID,
        tenantId: TENANT_ID,
        events: [{ type: SPAN_RECEIVED, data: canonicalizeEnvelope() }],
      });

      const call = client.insertCalls[0];
      const row = call?.rows[0] ?? [];
      const valueOf = (column: string) =>
        row[(call?.columns ?? []).indexOf(column)];

      expect(valueOf("TraceId")).toBe(TRACE_ID);
      expect(valueOf("TraceName")).toBe("chat-completion");
      expect(valueOf("Models")).toEqual(["gpt-5-mini"]);
      expect(valueOf("ContainsAi")).toBe(true);
    });
  });

  describe("when the canonicalised span reaches the span-storage map", () => {
    it("maps it to one stored_spans row", async () => {
      const client = createFakeClient();
      const built = createTraceProcessingPipeline({ client });

      const result = await built.maps.spanStorage!.apply({
        tenantId: TENANT_ID,
        events: [{ type: SPAN_RECEIVED, data: canonicalizeEnvelope() }],
      });

      expect(result).toEqual({ written: 1 });
      expect(client.insertCalls[0]?.table).toBe(storedSpansTable.name);
      expect(client.insertCalls[0]?.columns).toEqual(
        storedSpansTable.columnNames,
      );
    });
  });
});
