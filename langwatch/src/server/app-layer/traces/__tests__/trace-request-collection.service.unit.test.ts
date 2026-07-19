import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";

import type {
  PIIRedactionLevel,
  RecordSpanCommandData,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
import type { SpanDedupService } from "../span-dedupe.service";
import {
  buildBoundedErrorMessage,
  TraceRequestCollectionService,
} from "../trace-request-collection.service";

// ─── Tracer / logger mocks ─────────────────────────────────────────────────
// `handleOtlpTraceRequest` wraps iteration in `tracer.withActiveSpan` and
// emits per-reason attributes. Mock the langwatch tracer as a passthrough so
// the iteration runs synchronously and captures setAttribute calls for
// assertion. Mock the logger to silence warn/error noise in test output.

const setAttribute = vi.fn();
const addEvent = vi.fn();

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: typeof setAttribute;
        setAttributes: () => void;
        addEvent: typeof addEvent;
      }) => unknown,
    ) =>
      fn({
        setAttribute,
        setAttributes: () => {},
        addEvent,
      }),
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

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
  const recordSpan =
    vi.fn<(data: RecordSpanCommandData) => Promise<void>>(() => Promise.resolve());

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

// Reset the tracer-mock attribute capture between tests so per-test
// assertions don't bleed into each other.
beforeEach(() => {
  vi.clearAllMocks();
});

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

// ─── handleOtlpTraceRequest (issue #5898) ──────────────────────────────────
// The OTLP partial-success contract: a batch with mixed valid/invalid spans
// must NOT fail the whole HTTP request. It must accept the valid ones, drop
// the invalid ones, and surface a bounded `partialSuccess.errorMessage` plus
// the rejected count. Per-reason breakdown lands on the tracer span.
describe("TraceRequestCollectionService.handleOtlpTraceRequest", () => {
  function makeTraceRequest(
    spans: Partial<OtlpSpan>[],
  ): IExportTraceServiceRequest {
    return {
      resourceSpans: [
        {
          resource: { attributes: [], droppedAttributesCount: 0 },
          scopeSpans: [
            {
              scope: { name: "test-scope" },
              spans: spans.map((s, i) =>
                makeOtlpSpan({
                  traceId: `trace_${i}`,
                  spanId: `span_${i}`.padEnd(16, "0").slice(0, 16),
                  name: `span-${i}`,
                  ...s,
                }),
              ),
            },
          ],
        },
      ],
    } as unknown as IExportTraceServiceRequest;
  }

  describe("given an all-valid batch", () => {
    it("returns rejectedSpans=0 and empty errorMessage", async () => {
      const { service } = makeService({ dedupAcquire: true });
      const req = makeTraceRequest([{}, {}]);

      const result = await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      expect(result.rejectedSpans).toBe(0);
      expect(result.errorMessage).toBe("");
    });

    it("emits zero rejected-by-reason attributes on the tracer span", async () => {
      const { service } = makeService({ dedupAcquire: true });
      const req = makeTraceRequest([{}, {}]);

      await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      const calls = setAttribute.mock.calls as unknown as [string, unknown][];
      const byReason = Object.fromEntries(
        calls.filter(([k]) => k.startsWith("spans.ingestion.rejected.by_reason.")),
      );
      expect(byReason).toEqual({
        "spans.ingestion.rejected.by_reason.validation": 0,
        "spans.ingestion.rejected.by_reason.age": 0,
        "spans.ingestion.rejected.by_reason.queue": 0,
      });
    });
  });

  describe("given a batch where one span omits kind (issue #5898 reproducer)", () => {
    it("accepts the kind-omitted span instead of silently dropping it", async () => {
      const { service, recordSpan } = makeService({ dedupAcquire: true });
      // Span 0 omits `kind` — pre-fix this would be dropped as a validation
      // failure. Post-fix the schema defaults `kind` to UNSPECIFIED (0).
      const req = makeTraceRequest([{ kind: undefined as never }, {}]);

      const result = await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      expect(result.rejectedSpans).toBe(0);
      expect(recordSpan).toHaveBeenCalledTimes(2);
    });
  });

  describe("given a batch with one invalid span (missing required fields)", () => {
    it("returns rejectedSpans=1 with a bounded error message", async () => {
      const { service } = makeService({ dedupAcquire: true });
      // Span 0 has a non-string spanId — fails schema validation.
      const req = makeTraceRequest([
        { spanId: 12345 as unknown as string },
        {},
      ]);

      const result = await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toContain("span validation failed");
      // Sanity: the error message is bounded — even if 100 spans fail
      // identically, the output stays short.
      expect(result.errorMessage.length).toBeLessThan(500);
    });

    it("increments the validation by-reason attribute by 1", async () => {
      const { service } = makeService({ dedupAcquire: true });
      const req = makeTraceRequest([
        { spanId: 12345 as unknown as string },
        {},
      ]);

      await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      const calls = setAttribute.mock.calls as unknown as [string, unknown][];
      const validation = calls.find(
        ([k]) => k === "spans.ingestion.rejected.by_reason.validation",
      );
      expect(validation?.[1]).toBe(1);
    });
  });

  describe("given a batch with one too-old span", () => {
    it("returns rejectedSpans=1 with the age error message", async () => {
      const { service } = makeService({ dedupAcquire: true });
      // startTimeUnixNano 1 year ago — past the 31-day window.
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const req = makeTraceRequest([
        { startTimeUnixNano: String(oneYearAgo * 1_000_000) },
        {},
      ]);

      const result = await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toContain("31 days");
    });

    it("increments the age by-reason attribute by 1", async () => {
      const { service } = makeService({ dedupAcquire: true });
      const oneYearAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
      const req = makeTraceRequest([
        { startTimeUnixNano: String(oneYearAgo * 1_000_000) },
        {},
      ]);

      await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      const calls = setAttribute.mock.calls as unknown as [string, unknown][];
      const age = calls.find(
        ([k]) => k === "spans.ingestion.rejected.by_reason.age",
      );
      expect(age?.[1]).toBe(1);
    });
  });

  describe("given a batch where one span's recordSpan dispatch fails", () => {
    it("returns rejectedSpans=1 with the dispatch error and counts as queue", async () => {
      const { service, recordSpan } = makeService({ dedupAcquire: true });
      recordSpan
        .mockResolvedValueOnce(undefined) // span 0 ok
        .mockRejectedValueOnce(new Error("redis unavailable")); // span 1 fails

      const req = makeTraceRequest([{}, {}]);
      const result = await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      expect(result.rejectedSpans).toBe(1);
      expect(result.errorMessage).toContain("redis unavailable");
    });
  });

  describe("given a batch where 200 spans all fail validation identically", () => {
    it("de-duplicates the error message so the response stays bounded", async () => {
      const { service } = makeService({ dedupAcquire: true });
      // 200 spans with the same invalid spanId shape — pre-fix this would
      // produce a 10KB+ error string. Post-fix it collapses to one entry.
      const req = makeTraceRequest(
        Array.from({ length: 200 }, () => ({
          spanId: 12345 as unknown as string,
        })),
      );

      const result = await service.handleOtlpTraceRequest(
        tenantId,
        req,
        piiRedactionLevel,
      );

      expect(result.rejectedSpans).toBe(200);
      // One distinct error → one entry. The full string stays short.
      expect(result.errorMessage.length).toBeLessThan(500);
    });
  });
});

// ─── buildBoundedErrorMessage (issue #5898) ────────────────────────────────
// `partialSuccess.errorMessage` is the only signal a misconfigured SDK gets
// back when some spans in a batch are dropped. Without bounding, a batch with
// 200 malformed spans would produce a 100KB+ error string — too big to be
// actionable and big enough to bloat the response. These tests pin the contract
// surfaced in the OTLP `partialSuccess.errorMessage` field.
describe("buildBoundedErrorMessage", () => {
  describe("when the error list is empty", () => {
    it("returns an empty string", () => {
      expect(buildBoundedErrorMessage([])).toBe("");
    });
  });

  describe("when the error list has one entry", () => {
    it("returns that entry verbatim", () => {
      expect(buildBoundedErrorMessage(["boom"])).toBe("boom");
    });
  });

  describe("when the same error repeats N times", () => {
    it("de-duplicates to a single entry (a misconfigured SDK fails the same way per span)", () => {
      const errors = Array.from({ length: 200 }, () => "kind is required");
      expect(buildBoundedErrorMessage(errors)).toBe("kind is required");
    });
  });

  describe("when there are several distinct errors", () => {
    it("joins them with '; ' in insertion order", () => {
      expect(
        buildBoundedErrorMessage(["a", "b", "c"]),
      ).toBe("a; b; c");
    });

    it("de-duplicates while preserving first-seen order", () => {
      expect(
        buildBoundedErrorMessage(["a", "b", "a", "c", "b"]),
      ).toBe("a; b; c");
    });
  });

  describe("when distinct errors exceed the response cap", () => {
    it("keeps the first 5 distinct entries and appends '+N more'", () => {
      const errors = ["e1", "e2", "e3", "e4", "e5", "e6", "e7"];
      const result = buildBoundedErrorMessage(errors);
      expect(result).toBe("e1; e2; e3; e4; e5; +2 more");
    });

    it("does not append '+0 more' when distinct count equals the cap", () => {
      const errors = ["e1", "e2", "e3", "e4", "e5"];
      expect(buildBoundedErrorMessage(errors)).toBe("e1; e2; e3; e4; e5");
    });
  });

  describe("when a single error exceeds the per-error char cap", () => {
    it("truncates that error to the cap with a '...' suffix", () => {
      // Build a 600-char error; cap is 500 incl. the "..." suffix.
      const longError = "x".repeat(600);
      const result = buildBoundedErrorMessage([longError]);
      // The result should be 500 chars total (497 'x' + "...") — pin length
      // rather than exact content so the cap can move without breaking the
      // test as long as the contract holds.
      expect(result.length).toBe(500);
      expect(result.endsWith("...")).toBe(true);
    });

    it("truncates each oversize error independently when several appear", () => {
      const long1 = "a".repeat(600);
      const long2 = "b".repeat(600);
      const result = buildBoundedErrorMessage([long1, long2]);
      expect(result.length).toBe(/* "aaa..." */ 500 + /* "; " */ 2 + /* "bbb..." */ 500);
      expect(result.endsWith("...")).toBe(true);
    });
  });
});
