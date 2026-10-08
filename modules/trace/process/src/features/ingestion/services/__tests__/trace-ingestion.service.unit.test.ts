/** OTLP receiver imports spans: rejection tally carefully counts validation
 * failures, and one bad span doesn't spoil the batch. */

import { shouldFilterCodingAgentSpan } from "@langwatch/coding-agent-contract";
import {
  createRecordingMeterProvider,
  type RecordingMeterProvider,
} from "@langwatch/observability/metrics/testing";
import { parseOtlpTraces } from "@langwatch/otlp";
import type { OtlpSpan, PIIRedactionLevel, RecordSpanCommandData } from "@langwatch/trace-contract";
import { SPAN_MAX_PAST_MS } from "@langwatch/trace-contract";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type SpanDedupClaim,
  TraceSpanDedupRepository,
} from "../../../../repositories/trace-span-dedup.repository.ts";
import { TraceEdgeMediaPayloadService } from "../../../media/services/trace-edge-media-payload.service.ts";
import { TraceEdgeMediaTelemetryService } from "../../../media/services/trace-edge-media-telemetry.service.ts";
import {
  type CodingAgentIngestFilter,
  TraceIngressCommand,
  TraceIngestionService,
} from "../trace-ingestion.service.ts";

class TestTraceIngressCommand extends TraceIngressCommand {
  readonly record = vi.fn(async (_data: RecordSpanCommandData) => void 0);

  recordSpan(data: RecordSpanCommandData): Promise<void> {
    return this.record(data);
  }
}

class TestTraceSpanDedup extends TraceSpanDedupRepository {
  readonly acquire = vi.fn<() => Promise<SpanDedupClaim>>(async () => ({ outcome: "acquired" }));
  readonly confirm = vi.fn(async () => void 0);
  readonly release = vi.fn(async () => void 0);

  claimProcessing(): Promise<SpanDedupClaim> {
    return this.acquire();
  }

  confirmProcessed(): Promise<void> {
    return this.confirm();
  }

  releaseOnFailure(): Promise<void> {
    return this.release();
  }
}

/** Says yes to every span, so the test exercises the service's use of the filter. */
const filterEverything: CodingAgentIngestFilter = { shouldFilterSpan: () => true };

function span(over: Partial<OtlpSpan> = {}): OtlpSpan {
  const now = Date.now();
  return {
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: "",
    name: "span",
    kind: 1,
    startTimeUnixNano: String(now * 1_000_000),
    endTimeUnixNano: String(now * 1_000_000),
    attributes: [],
    droppedAttributesCount: 0,
    events: [],
    droppedEventsCount: 0,
    links: [],
    droppedLinksCount: 0,
    status: { code: 0, message: "" },
    traceState: "",
    flags: 0,
    ...over,
  };
}

function fixture(
  options: { codingAgentSpanFilterEnabled?: boolean; filterEverything?: boolean } = {},
) {
  const dedup = new TestTraceSpanDedup();
  const commands = new TestTraceIngressCommand();
  const service = TraceIngestionService.create({
    codingAgentFilter: options.filterEverything
      ? filterEverything
      : { shouldFilterSpan: shouldFilterCodingAgentSpan },
    codingAgentSpanFilterEnabled: options.codingAgentSpanFilterEnabled ?? false,
    dedup,
    commands,
  });
  return { commands, dedup, service };
}

const piiRedactionLevel: PIIRedactionLevel = "ESSENTIAL";

const input = () => ({
  tenantId: "project-1",
  span: span(),
  resource: null,
  instrumentationScope: null,
  piiRedactionLevel,
});

/** One export request holding the given spans in a single resource and scope. */
const request = (spans: unknown[]): IExportTraceServiceRequest =>
  ({
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [{ scope: { name: "test", version: "1" }, spans }],
      },
    ],
  }) as never;

const handle = (service: TraceIngestionService, spans: unknown[]) =>
  service.handleOtlpTraceRequest("project-1", request(spans), piiRedactionLevel);

describe("TraceIngestionService.ingestNormalizedSpan", () => {
  describe("given the span's dedup lock is free", () => {
    it("dispatches and confirms it", async () => {
      const { commands, dedup, service } = fixture();

      await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
        status: "collected",
      });
      expect(commands.record).toHaveBeenCalledOnce();
      expect(dedup.confirm).toHaveBeenCalledOnce();
    });
  });

  describe("given another worker already claimed the span", () => {
    it("does not dispatch it a second time", async () => {
      const { commands, dedup, service } = fixture();
      dedup.acquire.mockResolvedValueOnce({ outcome: "held" });

      await expect(service.ingestNormalizedSpan(input())).resolves.toEqual({
        status: "deduped",
      });
      expect(commands.record).not.toHaveBeenCalled();
      expect(dedup.confirm).not.toHaveBeenCalled();
    });
  });

  describe("given the command dispatch fails", () => {
    it("releases the lock it acquired, so a retry can claim it", async () => {
      const { commands, dedup, service } = fixture();
      commands.record.mockRejectedValueOnce(new Error("dispatch failed"));

      await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
        status: "failed",
        error: "dispatch failed",
      });
      expect(dedup.release).toHaveBeenCalledOnce();
    });
  });

  describe("given the dedup store is unavailable", () => {
    it("fails open and ingests the span anyway", async () => {
      const { commands, dedup, service } = fixture();
      dedup.acquire.mockResolvedValueOnce({ outcome: "unknown" });

      await expect(service.ingestNormalizedSpan(input())).resolves.toMatchObject({
        status: "collected",
      });
      expect(commands.record).toHaveBeenCalledOnce();
    });
  });
});

describe("TraceIngestionService.handleOtlpTraceRequest", () => {
  describe("given a request holding good spans", () => {
    it("reports nothing rejected", async () => {
      const { service } = fixture();

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 0,
        ingestionFailures: 0,
        ingestionFailureMessage: "",
        errorMessage: "",
      });
    });

    it("dispatches every span it walks past", async () => {
      const { commands, service } = fixture();

      await handle(service, [span({ spanId: "span-1" }), span({ spanId: "span-2" })]);

      expect(commands.record).toHaveBeenCalledTimes(2);
    });

    it("walks every resource and every scope, not just the first", async () => {
      const { commands, service } = fixture();
      const oneScope = (spanId: string) => ({
        scope: { name: "test", version: "1" },
        spans: [span({ spanId })],
      });

      await service.handleOtlpTraceRequest(
        "project-1",
        {
          resourceSpans: [
            { resource: { attributes: [] }, scopeSpans: [oneScope("a"), oneScope("b")] },
            { resource: { attributes: [] }, scopeSpans: [oneScope("c")] },
          ],
        } as never,
        piiRedactionLevel,
      );

      expect(commands.record).toHaveBeenCalledTimes(3);
    });

    it("passes the tenant and the redaction level down to the command", async () => {
      const { commands, service } = fixture();

      await handle(service, [span()]);

      expect(commands.record.mock.calls[0]?.[0]).toMatchObject({
        tenantId: "project-1",
        piiRedactionLevel: "ESSENTIAL",
      });
    });
  });

  describe("given a request with nothing in it", () => {
    it("reports nothing rejected rather than failing", async () => {
      const { service } = fixture();

      await expect(
        service.handleOtlpTraceRequest("project-1", {} as never, piiRedactionLevel),
      ).resolves.toEqual({
        rejectedSpans: 0,
        ingestionFailures: 0,
        ingestionFailureMessage: "",
        errorMessage: "",
      });
    });
  });

  describe("given a span that fails validation", () => {
    it("rejects it and says why", async () => {
      const { service } = fixture();

      const result = await handle(service, [{ traceId: "trace-1" }]);

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toContain("span validation failed");
    });

    it("still ingests its neighbours in the same scope", async () => {
      const { commands, service } = fixture();

      await handle(service, [{ traceId: "trace-1" }, span()]);

      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given a span that started more than 31 days ago", () => {
    it("rejects it and names the age as the reason", async () => {
      const { commands, service } = fixture();
      const tooOld = Date.now() - SPAN_MAX_PAST_MS - 60_000;

      const result = await handle(service, [
        span({ startTimeUnixNano: String(tooOld * 1_000_000) }),
      ]);

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toContain("31 days in the past");
      expect(commands.record).not.toHaveBeenCalled();
    });

    it("accepts one that is only just inside the window", async () => {
      const { commands, service } = fixture();
      const justInside = Date.now() - SPAN_MAX_PAST_MS + 60_000;

      await handle(service, [span({ startTimeUnixNano: String(justInside * 1_000_000) })]);

      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given a span whose start time cannot be stored", () => {
    /** @scenario "A span whose start time cannot be stored is rejected at ingestion" */
    it("drops it with a named reason and never dispatches it", async () => {
      const { commands, service } = fixture();
      const nowMs = BigInt(Date.now());
      // A millisecond value scaled into nanoseconds twice over.
      const doubleScaled = String(nowMs * 1_000_000n * 1_000_000n);

      const result = await handle(service, [
        span({ startTimeUnixNano: doubleScaled, endTimeUnixNano: doubleScaled }),
      ]);

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toBe("span start time is not a valid timestamp");
      expect(commands.record).not.toHaveBeenCalled();
    });

    /** @scenario "A span whose start time cannot be stored is rejected at ingestion" */
    it("names the end time when only the end is past what storage can hold", async () => {
      const { commands, service } = fixture();
      const nowMs = BigInt(Date.now());

      const result = await handle(service, [
        span({
          startTimeUnixNano: String(nowMs * 1_000_000n),
          endTimeUnixNano: String(nowMs * 1_000_000n * 1_000_000n),
        }),
      ]);

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toBe("span end time is not a valid timestamp");
      expect(commands.record).not.toHaveBeenCalled();
    });

    /** @scenario "A span whose start time cannot be stored is rejected at ingestion" */
    it("drops only that span and still dispatches a valid sibling", async () => {
      const { commands, service } = fixture();
      const nowMs = BigInt(Date.now());

      const result = await handle(service, [
        span({
          spanId: "span_bad",
          startTimeUnixNano: String(nowMs * 1_000_000n),
          endTimeUnixNano: "not-a-number",
        }),
        span({ spanId: "span_good" }),
      ]);

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toBe("span end time is not a valid timestamp");
      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given a span starting far in the future but within what storage holds", () => {
    /** @scenario "A span starting far in the future is still accepted when storage can hold it" */
    it("accepts it, because the rule refuses only what cannot be stored", async () => {
      const { commands, service } = fixture();
      const year2100Ms = BigInt(Date.UTC(2100, 0, 1));

      const result = await handle(service, [
        span({
          startTimeUnixNano: String(year2100Ms * 1_000_000n),
          endTimeUnixNano: String((year2100Ms + 2000n) * 1_000_000n),
        }),
      ]);

      expect(result.rejectedSpans).toBe(0);
      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given the coding-agent filter is on and matches", () => {
    it("does not dispatch the span", async () => {
      const { commands, service } = fixture({
        codingAgentSpanFilterEnabled: true,
        filterEverything: true,
      });

      await handle(service, [span()]);

      expect(commands.record).not.toHaveBeenCalled();
    });

    it("does not count the span as rejected, because dropping it was the point", async () => {
      const { service } = fixture({
        codingAgentSpanFilterEnabled: true,
        filterEverything: true,
      });

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 0,
        ingestionFailures: 0,
        ingestionFailureMessage: "",
        errorMessage: "",
      });
    });
  });

  describe("given the coding-agent filter matches but is switched off", () => {
    it("ingests the span anyway", async () => {
      const { commands, service } = fixture({
        codingAgentSpanFilterEnabled: false,
        filterEverything: true,
      });

      await handle(service, [span()]);

      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given a span dedup has already seen", () => {
    it("does not count it as rejected", async () => {
      const { dedup, service } = fixture();
      dedup.acquire.mockResolvedValue({ outcome: "held" });

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 0,
        ingestionFailures: 0,
        ingestionFailureMessage: "",
        errorMessage: "",
      });
    });
  });

  describe("given the pipeline throws on a span", () => {
    it("counts it as rejected and surfaces the message", async () => {
      const { commands, service } = fixture();
      commands.record.mockRejectedValueOnce(new Error("pipeline down"));

      await expect(handle(service, [span()])).resolves.toEqual({
        rejectedSpans: 1,
        ingestionFailures: 1,
        ingestionFailureMessage: "pipeline down",
        errorMessage: "pipeline down",
      });
    });
  });

  describe("given several spans fail for different reasons", () => {
    it("counts them all and joins their messages", async () => {
      const { commands, service } = fixture();
      commands.record.mockRejectedValueOnce(new Error("pipeline down"));

      const result = await handle(service, [span(), { traceId: "bad" }]);

      expect(result.rejectedSpans).toBe(2);
      expect(result.errorMessage).toContain("pipeline down");
      expect(result.errorMessage).toContain("span validation failed");
      expect(result.errorMessage).toContain("; ");
    });
  });

  describe("given the resource or scope fails to parse", () => {
    it("still ingests the spans, with no resource attached", async () => {
      const { commands, service } = fixture();

      await service.handleOtlpTraceRequest(
        "project-1",
        {
          resourceSpans: [
            { resource: "not a resource", scopeSpans: [{ scope: 42, spans: [span()] }] },
          ],
        } as never,
        piiRedactionLevel,
      );

      expect(commands.record).toHaveBeenCalledOnce();
      expect(commands.record.mock.calls[0]?.[0]).toMatchObject({
        resource: null,
        instrumentationScope: null,
      });
    });
  });
});

/** The same span as ProtoJSON omitting default-valued fields, and as protobuf. */
function defaultOmittingBodies() {
  const nowNs = String(Date.now() * 1_000_000);
  const ids = {
    traceId: "aaaa0000000000000000000000000001",
    spanId: "bbbb000000000001",
    linkTraceId: "cccc0000000000000000000000000001",
    linkSpanId: "dddd000000000001",
  };
  const toBuffer = (body: string | Uint8Array): ArrayBuffer => {
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  };
  const hex = (value: string) => Buffer.from(value, "hex");
  const json = {
    resourceSpans: [
      {
        resource: {},
        scopeSpans: [
          {
            scope: { name: "test" },
            spans: [
              {
                traceId: ids.traceId,
                spanId: ids.spanId,
                name: "span",
                startTimeUnixNano: nowNs,
                endTimeUnixNano: nowNs,
                links: [{ traceId: ids.linkTraceId, spanId: ids.linkSpanId }],
                events: [{ timeUnixNano: nowNs, name: "evt" }],
              },
            ],
          },
        ],
      },
    ],
  };
  const requestType = (root as any).opentelemetry.proto.collector.trace.v1
    .ExportTraceServiceRequest;
  const protobuf = requestType
    .encode(
      requestType.create({
        resourceSpans: [
          {
            resource: {},
            scopeSpans: [
              {
                scope: { name: "test" },
                spans: [
                  {
                    traceId: hex(ids.traceId),
                    spanId: hex(ids.spanId),
                    name: "span",
                    startTimeUnixNano: nowNs,
                    endTimeUnixNano: nowNs,
                    links: [{ traceId: hex(ids.linkTraceId), spanId: hex(ids.linkSpanId) }],
                    events: [{ timeUnixNano: nowNs, name: "evt" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    )
    .finish();
  return { jsonBody: toBuffer(JSON.stringify(json)), protobufBody: toBuffer(protobuf) };
}

/** What a recorded span carries, apart from the decoders' scalar encodings. */
function storedContent({ span: stored, resource, instrumentationScope }: RecordSpanCommandData) {
  return {
    traceId: stored.traceId,
    spanId: stored.spanId,
    name: stored.name,
    kind: stored.kind,
    attributes: stored.attributes,
    links: stored.links.map((link) => ({
      traceId: link.traceId,
      spanId: link.spanId,
      attributes: link.attributes ?? [],
      droppedAttributesCount: link.droppedAttributesCount ?? 0,
    })),
    events: stored.events.map((event) => ({
      name: event.name,
      attributes: event.attributes ?? [],
      droppedAttributesCount: event.droppedAttributesCount ?? 0,
    })),
    resourceAttributes: resource?.attributes ?? [],
    scopeName: instrumentationScope?.name,
  };
}

describe("TraceIngestionService.handleOtlpTraceRequest with ProtoJSON default-valued fields omitted", () => {
  describe("given a span with no attributes or kind, and a link, event and resource with only required fields", () => {
    /** @scenario "An OTLP/JSON request omitting default-valued fields ingests every span" */
    it("ingests the span without rejecting it", async () => {
      const { commands, service } = fixture();
      const parsed = parseOtlpTraces(defaultOmittingBodies().jsonBody, "application/json");
      if (!parsed.ok) throw new Error(parsed.error);

      const result = await service.handleOtlpTraceRequest(
        "project-1",
        parsed.request,
        piiRedactionLevel,
      );

      expect(result.rejectedSpans).toBe(0);
      expect(commands.record).toHaveBeenCalledOnce();
    });
  });

  describe("given the same span sent as OTLP/JSON with omitted defaults and as protobuf", () => {
    /** @scenario "A span sent as OTLP/JSON with omitted defaults is stored the same as its protobuf form" */
    it("stores the same span content from both", async () => {
      const { jsonBody, protobufBody } = defaultOmittingBodies();
      const ingest = async (body: ArrayBuffer, contentType: string) => {
        const parsed = parseOtlpTraces(body, contentType);
        if (!parsed.ok) throw new Error(parsed.error);
        const { commands, service } = fixture();
        const result = await service.handleOtlpTraceRequest(
          "project-1",
          parsed.request,
          piiRedactionLevel,
        );
        return { result, record: commands.record };
      };

      const json = await ingest(jsonBody, "application/json");
      const protobuf = await ingest(protobufBody, "application/x-protobuf");

      expect(json.result.rejectedSpans).toBe(0);
      expect(protobuf.result.rejectedSpans).toBe(0);
      expect(json.record).toHaveBeenCalledOnce();
      expect(protobuf.record).toHaveBeenCalledOnce();
      expect(storedContent(json.record.mock.calls[0]![0])).toEqual(
        storedContent(protobuf.record.mock.calls[0]![0]),
      );
    });
  });
});

describe("TraceIngestionService.handleOtlpTraceRequest span outcome series", () => {
  let metrics: RecordingMeterProvider;

  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    metrics.install();
  });

  afterEach(() => {
    metrics.uninstall();
  });

  describe("given a request with a collected, a deduped, a failed and an invalid span", () => {
    /** @scenario OTLP partial rejection exposes its cause independently of HTTP status */
    it("counts each outcome under its own label and rejects only failed and invalid spans", async () => {
      const { commands, dedup, service } = fixture();
      dedup.acquire.mockResolvedValueOnce({ outcome: "held" });
      commands.record.mockRejectedValueOnce(new Error("queue is down"));

      const result = await handle(service, [
        { traceId: "trace-1" },
        span({ spanId: "span-deduped" }),
        span({ spanId: "span-failed" }),
        span({ spanId: "span-collected" }),
      ]);

      const outcome = (name: string) =>
        metrics.valueOf("trace_ingestion_spans_total", {
          operation: "otlp_traces",
          outcome: name,
        });
      expect({
        collected: outcome("collected"),
        dropped: outcome("dropped"),
        deduped: outcome("deduped"),
        failed: outcome("failed"),
        filtered: outcome("filtered"),
      }).toEqual({ collected: 1, dropped: 1, deduped: 1, failed: 1, filtered: 0 });
      expect(result.rejectedSpans).toBe(2);
      expect(result.ingestionFailures).toBe(1);
    });
  });
});

describe("TraceIngestionService.handleOtlpTraceRequest edge media fail-open series", () => {
  let metrics: RecordingMeterProvider;

  beforeEach(() => {
    metrics = createRecordingMeterProvider();
    metrics.install();
  });

  afterEach(() => {
    metrics.uninstall();
  });

  describe("given a project whose feature-flag store cannot be read", () => {
    /** @scenario The receiver publishes the edge media fail-open series */
    it("ingests the span unmodified and counts the fail-open under the flag_store stage", async () => {
      const commands = new TestTraceIngressCommand();
      const original = JSON.stringify([
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } },
          ],
        },
      ]);
      const service = TraceIngestionService.create({
        codingAgentFilter: { shouldFilterSpan: shouldFilterCodingAgentSpan },
        codingAgentSpanFilterEnabled: false,
        dedup: new TestTraceSpanDedup(),
        commands,
        payloads: TraceEdgeMediaPayloadService.create({
          deps: {
            featureFlags: {
              isEnabled: async () => {
                throw new Error("flag store unreachable");
              },
            } as never,
            hasContentDropRules: async () => false,
            telemetry: TraceEdgeMediaTelemetryService.create(),
          },
          logger: { info: vi.fn(), warn: vi.fn() },
        }),
      });

      const result = await handle(service, [
        span({ attributes: [{ key: "langwatch.input", value: { stringValue: original } }] }),
      ]);

      expect(result.rejectedSpans).toBe(0);
      expect(commands.record).toHaveBeenCalledOnce();
      expect(commands.record.mock.calls[0]?.[0].span.attributes).toContainEqual({
        key: "langwatch.input",
        value: { stringValue: original },
      });
      expect(
        metrics.valueOf("langwatch_edge_media_extract_fail_open_total", { reason: "flag_store" }),
      ).toBe(1);
    });
  });
});
