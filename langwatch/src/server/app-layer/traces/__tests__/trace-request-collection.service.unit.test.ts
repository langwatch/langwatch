import { describe, expect, it, vi } from "vitest";

import type {
  PIIRedactionLevel,
  RecordSpanCommandData,
} from "../../../event-sourcing/pipelines/trace-processing/schemas/commands";
import type { OtlpSpan } from "../../../event-sourcing/pipelines/trace-processing/schemas/otlp";
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
