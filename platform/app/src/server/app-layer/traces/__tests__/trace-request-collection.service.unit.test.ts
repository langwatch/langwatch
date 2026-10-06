import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";
import * as root from "@opentelemetry/otlp-transformer/build/src/generated/root";
import { describe, expect, it, vi } from "vitest";
import type {
  PIIRedactionLevel,
  RecordSpanCommandData,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import { parseOtlpTraces } from "../../../otel/parseOtlpBody";
import type { SpanDedupService } from "../span-dedupe.service";
import { TraceRequestCollectionService } from "../trace-request-collection.service";

function makeOtlpSpan(overrides: Partial<OtlpSpan> = {}): OtlpSpan {
  const now = Date.now();
  return {
    traceId: "trace_test",
    spanId: "span_a",
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
    ...overrides,
  } as OtlpSpan;
}

function makeService(opts: { dedupAcquire?: boolean | null } = {}) {
  const recordSpan = vi.fn<(data: RecordSpanCommandData) => Promise<void>>(() =>
    Promise.resolve(),
  );

  const tryAcquireProcessingLock = vi.fn<
    SpanDedupService["tryAcquireProcessingLock"]
  >(() => Promise.resolve(opts.dedupAcquire ?? true));
  const tryConfirmProcessed = vi.fn<SpanDedupService["tryConfirmProcessed"]>(
    () => Promise.resolve(),
  );
  const tryReleaseOnFailure = vi.fn<SpanDedupService["tryReleaseOnFailure"]>(
    () => Promise.resolve(),
  );

  const dedup: SpanDedupService = {
    tryAcquireProcessingLock,
    tryConfirmProcessed,
    tryReleaseOnFailure,
  };

  const service = new TraceRequestCollectionService({ dedup, recordSpan });
  return {
    service,
    recordSpan,
    tryAcquireProcessingLock,
    tryConfirmProcessed,
    tryReleaseOnFailure,
  };
}

const tenantId = "project_test";
const piiRedactionLevel: PIIRedactionLevel = "ESSENTIAL";

/** Spans on the wire, in the envelope `handleOtlpTraceRequest` unwraps. */
function makeTraceRequest(...spans: OtlpSpan[]): IExportTraceServiceRequest {
  return {
    resourceSpans: [
      {
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [{ scope: { name: "test" }, spans }],
      },
    ],
  } as unknown as IExportTraceServiceRequest;
}

describe("TraceRequestCollectionService.ingestNormalizedSpan", () => {
  describe("given the dedup gate releases the span", () => {
    describe("when a single span is ingested", () => {
      it("dispatches recordSpan exactly once and confirms the lock", async () => {
        const { service, recordSpan, tryConfirmProcessed } = makeService({
          dedupAcquire: true,
        });
        const span = makeOtlpSpan({ traceId: "trace_x", spanId: "span_1" });

        const result = await service.ingestNormalizedSpan({
          tenantId,
          span,
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel,
        });

        expect(result.status).toBe("collected");
        expect(recordSpan).toHaveBeenCalledTimes(1);
        expect(tryConfirmProcessed).toHaveBeenCalledWith(
          tenantId,
          "trace_x",
          "span_1",
        );
      });
    });
  });

  describe("given the dedup gate has already claimed the span", () => {
    describe("when the same span is ingested again within the dedup window", () => {
      it("reports deduped and does not dispatch recordSpan", async () => {
        const { service, recordSpan, tryConfirmProcessed } = makeService({
          dedupAcquire: false,
        });
        const span = makeOtlpSpan({ traceId: "trace_x", spanId: "span_1" });

        const result = await service.ingestNormalizedSpan({
          tenantId,
          span,
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel,
        });

        expect(result.status).toBe("deduped");
        expect(recordSpan).not.toHaveBeenCalled();
        expect(tryConfirmProcessed).not.toHaveBeenCalled();
      });
    });
  });

  describe("given recordSpan throws", () => {
    describe("when the dedup lock was acquired by this attempt", () => {
      it("releases the lock so a retry can proceed", async () => {
        const { service, recordSpan, tryReleaseOnFailure } = makeService({
          dedupAcquire: true,
        });
        recordSpan.mockRejectedValueOnce(new Error("dispatch failed"));
        const span = makeOtlpSpan({ traceId: "trace_x", spanId: "span_1" });

        const result = await service.ingestNormalizedSpan({
          tenantId,
          span,
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel,
        });

        expect(result.status).toBe("failed");
        expect(tryReleaseOnFailure).toHaveBeenCalledWith(
          tenantId,
          "trace_x",
          "span_1",
        );
      });
    });
  });

  describe("given dedup is unavailable (returns null)", () => {
    describe("when a span is ingested", () => {
      it("still dispatches recordSpan", async () => {
        const { service, recordSpan } = makeService({ dedupAcquire: null });
        const span = makeOtlpSpan({ traceId: "trace_x", spanId: "span_1" });

        const result = await service.ingestNormalizedSpan({
          tenantId,
          span,
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel,
        });

        expect(result.status).toBe("collected");
        expect(recordSpan).toHaveBeenCalledTimes(1);
      });
    });
  });
});

describe("TraceRequestCollectionService.handleOtlpTraceRequest", () => {
  describe("given a span whose start time cannot be stored", () => {
    describe("when it arrives over the OTLP door", () => {
      /** @scenario "A span whose start time cannot be stored is rejected at ingestion" */
      it("drops it with a named reason and never dispatches it", async () => {
        const { service, recordSpan } = makeService();
        const nowMs = BigInt(Date.now());

        const result = await service.handleOtlpTraceRequest(
          tenantId,
          makeTraceRequest(
            makeOtlpSpan({
              // A millisecond value scaled into nanoseconds twice over: the
              // shape that reached the KSUID's 48-bit seconds field.
              startTimeUnixNano: String(nowMs * 1_000_000n * 1_000_000n),
              endTimeUnixNano: String(nowMs * 1_000_000n * 1_000_000n),
            }),
          ),
          piiRedactionLevel,
        );

        expect(result.rejectedSpans).toBe(1);
        expect(result.ingestionFailures).toBe(0);
        expect(result.errorMessage).toBe(
          "span start time is not a valid timestamp",
        );
        expect(recordSpan).not.toHaveBeenCalled();
      });
    });

    describe("when only its end time is past what storage can hold", () => {
      /** @scenario "A span whose start time cannot be stored is rejected at ingestion" */
      it("names the end time, so the producer is pointed at the right field", async () => {
        const { service, recordSpan } = makeService();
        const nowMs = BigInt(Date.now());

        const result = await service.handleOtlpTraceRequest(
          tenantId,
          makeTraceRequest(
            makeOtlpSpan({
              startTimeUnixNano: String(nowMs * 1_000_000n),
              endTimeUnixNano: String(nowMs * 1_000_000n * 1_000_000n),
            }),
          ),
          piiRedactionLevel,
        );

        expect(result.rejectedSpans).toBe(1);
        expect(result.errorMessage).toBe(
          "span end time is not a valid timestamp",
        );
        expect(recordSpan).not.toHaveBeenCalled();
      });
    });

    describe("when its end time is not a number and a valid sibling arrives with it", () => {
      /** @scenario "A span whose start time cannot be stored is rejected at ingestion" */
      it("drops only that span and still dispatches the sibling", async () => {
        const { service, recordSpan } = makeService();
        const nowMs = BigInt(Date.now());

        const result = await service.handleOtlpTraceRequest(
          tenantId,
          makeTraceRequest(
            makeOtlpSpan({
              spanId: "span_bad",
              startTimeUnixNano: String(nowMs * 1_000_000n),
              endTimeUnixNano: "not-a-number",
            }),
            makeOtlpSpan({ spanId: "span_good" }),
          ),
          piiRedactionLevel,
        );

        expect(result.rejectedSpans).toBe(1);
        expect(result.ingestionFailures).toBe(0);
        expect(result.errorMessage).toBe(
          "span end time is not a valid timestamp",
        );
        expect(recordSpan).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given a span starting far in the future but within what storage holds", () => {
    describe("when it arrives over the OTLP door", () => {
      /** @scenario "A span starting far in the future is still accepted when storage can hold it" */
      it("accepts it, because the rule refuses only what cannot be stored", async () => {
        const { service, recordSpan } = makeService();
        const year2100Ms = BigInt(Date.UTC(2100, 0, 1));

        const result = await service.handleOtlpTraceRequest(
          tenantId,
          makeTraceRequest(
            makeOtlpSpan({
              startTimeUnixNano: String(year2100Ms * 1_000_000n),
              endTimeUnixNano: String((year2100Ms + 2000n) * 1_000_000n),
            }),
          ),
          piiRedactionLevel,
        );

        expect(result.rejectedSpans).toBe(0);
        expect(recordSpan).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given an OTLP/JSON request that omits default-valued fields", () => {
    describe("when a span has no attributes or kind, and its link, event and resource carry only required fields", () => {
      /** @scenario "An OTLP/JSON request omitting default-valued fields ingests every span" */
      it("ingests the span without rejecting it", async () => {
        const { service, recordSpan } = makeService();
        const nowNs = String(Date.now() * 1_000_000);
        const request = {
          resourceSpans: [
            {
              resource: {},
              scopeSpans: [
                {
                  scope: { name: "test" },
                  spans: [
                    {
                      traceId: "aaaa0000000000000000000000000001",
                      spanId: "bbbb000000000001",
                      name: "span",
                      startTimeUnixNano: nowNs,
                      endTimeUnixNano: nowNs,
                      links: [
                        {
                          traceId: "cccc0000000000000000000000000001",
                          spanId: "dddd000000000001",
                        },
                      ],
                      events: [{ timeUnixNano: nowNs, name: "evt" }],
                    },
                  ],
                },
              ],
            },
          ],
        } as unknown as IExportTraceServiceRequest;

        const result = await service.handleOtlpTraceRequest(
          tenantId,
          request,
          piiRedactionLevel,
        );

        expect(result.rejectedSpans).toBe(0);
        expect(recordSpan).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("given the same span sent as OTLP/JSON with omitted defaults and as protobuf", () => {
    describe("when each request is ingested", () => {
      /** @scenario "A span sent as OTLP/JSON with omitted defaults is stored the same as its protobuf form" */
      it("stores the same span content", async () => {
        // The JSON and protobuf decoders already differ in scalar encoding (Long vs
        // string nanos, null vs 0 for unset fields); compare what the span carries.
        const storedContent = (data: RecordSpanCommandData) => {
          const { span, resource, instrumentationScope } = data;
          return {
            traceId: span.traceId,
            spanId: span.spanId,
            name: span.name,
            kind: span.kind,
            attributes: span.attributes,
            links: span.links.map((l) => ({
              traceId: l.traceId,
              spanId: l.spanId,
              attributes: l.attributes ?? [],
              droppedAttributesCount: l.droppedAttributesCount ?? 0,
            })),
            events: span.events.map((e) => ({
              name: e.name,
              attributes: e.attributes ?? [],
              droppedAttributesCount: e.droppedAttributesCount ?? 0,
            })),
            resourceAttributes: resource?.attributes ?? [],
            scopeName: instrumentationScope?.name,
          };
        };

        const nowNs = String(Date.now() * 1_000_000);
        const ids = {
          traceId: "aaaa0000000000000000000000000001",
          spanId: "bbbb000000000001",
          linkTraceId: "cccc0000000000000000000000000001",
          linkSpanId: "dddd000000000001",
        };
        const toBuffer = (body: string | Uint8Array): ArrayBuffer => {
          const bytes =
            typeof body === "string" ? new TextEncoder().encode(body) : body;
          return bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer;
        };
        const hex = (value: string) => Buffer.from(value, "hex");

        const jsonBody = toBuffer(
          JSON.stringify({
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
                        links: [
                          { traceId: ids.linkTraceId, spanId: ids.linkSpanId },
                        ],
                        events: [{ timeUnixNano: nowNs, name: "evt" }],
                      },
                    ],
                  },
                ],
              },
            ],
          }),
        );

        const requestType = (root as any).opentelemetry.proto.collector.trace.v1
          .ExportTraceServiceRequest;
        const protobufBody = toBuffer(
          requestType
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
                            links: [
                              {
                                traceId: hex(ids.linkTraceId),
                                spanId: hex(ids.linkSpanId),
                              },
                            ],
                            events: [{ timeUnixNano: nowNs, name: "evt" }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              }),
            )
            .finish(),
        );

        const ingest = async (body: ArrayBuffer, contentType: string) => {
          const parsed = parseOtlpTraces(body, contentType);
          if (!parsed.ok) throw new Error(parsed.error);
          const harness = makeService();
          const result = await harness.service.handleOtlpTraceRequest(
            tenantId,
            parsed.request,
            piiRedactionLevel,
          );
          return { result, recordSpan: harness.recordSpan };
        };

        const json = await ingest(jsonBody, "application/json");
        const protobuf = await ingest(protobufBody, "application/x-protobuf");

        expect(json.result.rejectedSpans).toBe(0);
        expect(protobuf.result.rejectedSpans).toBe(0);
        expect(json.recordSpan).toHaveBeenCalledTimes(1);
        expect(protobuf.recordSpan).toHaveBeenCalledTimes(1);
        expect(storedContent(json.recordSpan.mock.calls[0]![0])).toEqual(
          storedContent(protobuf.recordSpan.mock.calls[0]![0]),
        );
      });
    });
  });
});
