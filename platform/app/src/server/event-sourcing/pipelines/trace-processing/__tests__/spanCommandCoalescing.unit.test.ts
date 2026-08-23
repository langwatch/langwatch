/**
 * ADR-066 pillar 2 for recordSpan: a trace's spans share one queue group, so a
 * busy trace appends one tiny insert per span unless the group's queued spans
 * are folded into a single multi-row append.
 *
 * The interesting case is the ADR-022 spool. An over-threshold span is queued as
 * a spoolRef with its attributes cleared, so its queued size — the only size the
 * drain's byte budget can weigh — is a few hundred bytes, while the span the
 * handler reconstitutes from object storage is over 256 KB and unbounded above.
 * The bound is therefore resolved per span so a spooled one caps itself at 1.
 *
 * See packages/eventing/specs/producer-append-coalescing.feature.
 */

import type { Event } from "@langwatch/eventing";
import { processCommandBatch } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";
import {
  RECORD_SPAN_DEDUPLICATION,
  RecordSpanCommand,
} from "../commands/recordSpanCommand";
import {
  createTraceProcessingPipeline,
  type TraceProcessingPipelineDeps,
} from "../pipeline";
import type { RecordSpanCommandData } from "../schemas/commands";
import {
  RECORD_SPAN_COALESCE_MAX_BATCH,
  RECORD_SPAN_COMMAND_TYPE,
  SPAN_RECEIVED_EVENT_TYPE,
} from "../schemas/constants";
import {
  buildTraceDeps,
  FIXTURE_TENANT_ID,
  FIXTURE_TRACE_ID,
  spanId,
  spanPayload,
} from "./support/traceProcessingFixtures";

function recordSpanRegistration(
  deps: Partial<TraceProcessingPipelineDeps> = {},
) {
  return createTraceProcessingPipeline(buildTraceDeps(deps)).commands.find(
    (candidate) => candidate.name === "recordSpan",
  );
}

/**
 * The coalescing bound the composition root installed on recordSpan, as the
 * resolver it is expected to be. A missing registration surfaces as a failed
 * call rather than a silent undefined.
 */
function coalesceResolverOf(deps: Partial<TraceProcessingPipelineDeps> = {}) {
  return recordSpanRegistration(deps)?.options?.coalesceMaxBatch as (
    payload: RecordSpanCommandData,
  ) => number;
}

/** A handler with every enrichment stubbed out — only the fold is under test. */
function stubbedHandler(blobStore?: unknown) {
  return new RecordSpanCommand({
    piiRedactionService: { redactSpan: async () => {} },
    costEnrichmentService: { enrichSpan: async () => {} },
    tokenEstimationService: { estimateSpanTokens: async () => {} },
    contentDropService: {
      dropSpanContent: async () => ({ droppedCount: 0, droppedCategories: [] }),
    },
    ...(blobStore ? { blobStore } : {}),
  } as never);
}

function batchParamsFor({
  payloads,
  storeEventsFn,
  handler = stubbedHandler(),
}: {
  payloads: RecordSpanCommandData[];
  storeEventsFn: (events: Event[], context: unknown) => Promise<void>;
  handler?: RecordSpanCommand;
}) {
  return {
    payloads: payloads as unknown as Record<string, unknown>[],
    commandType: RECORD_SPAN_COMMAND_TYPE,
    commandSchema: RecordSpanCommand.schema,
    handler,
    getAggregateId: RecordSpanCommand.getAggregateId,
    storeEventsFn: storeEventsFn as never,
    aggregateType: "trace" as const,
    commandName: "recordSpan",
    pipelineName: "trace_processing",
  };
}

describe("recordSpan append coalescing", () => {
  describe("given the trace-processing pipeline is defined", () => {
    describe("when recordSpan is registered without sharding", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      it("installs a bound resolved per span rather than one fixed for the command", () => {
        expect(typeof recordSpanRegistration()?.options?.coalesceMaxBatch).toBe(
          "function",
        );
      });

      it("folds an inline span up to the span batch bound", () => {
        const bound = coalesceResolverOf();

        expect(bound(spanPayload({ spanId: spanId(0) }))).toBe(
          RECORD_SPAN_COALESCE_MAX_BATCH,
        );
      });

      /** @scenario 'a single oversized item is appended on its own' */
      it("caps a spooled span at one, since its queued size hides what it becomes", () => {
        const bound = coalesceResolverOf();

        expect(
          bound(spanPayload({ spanId: spanId(0), spoolRef: "spool/abc" })),
        ).toBe(1);
      });

      it("leaves the existing span deduplication untouched", () => {
        expect(recordSpanRegistration()?.options?.deduplication).toBe(
          RECORD_SPAN_DEDUPLICATION,
        );
      });
    });

    describe("when recordSpan is registered with sharding enabled", () => {
      it("keeps the same per-span bound alongside the shard routing", () => {
        const bound = coalesceResolverOf({ spanCommandShardCount: 8 });

        expect(bound(spanPayload({ spanId: spanId(0) }))).toBe(
          RECORD_SPAN_COALESCE_MAX_BATCH,
        );
        expect(
          bound(spanPayload({ spanId: spanId(0), spoolRef: "spool/abc" })),
        ).toBe(1);
      });
    });
  });

  describe("given several queued spans from one trace", () => {
    describe("when the coalesced batch is processed", () => {
      /** @scenario 'many items for one aggregate become one insert' */
      /** @scenario 'coalescing preserves every item' */
      it("appends them as one insert holding every span in dispatch order", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2, 3].map((index) =>
          spanPayload({ spanId: spanId(index) }),
        );

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        const [events, context] = storeEventsFn.mock.calls[0]!;
        expect(
          (events as Event[]).map((event) => event.metadata?.spanId),
        ).toEqual(payloads.map((payload) => payload.span.spanId));
        expect(
          (events as Event[]).every(
            (event) => event.type === SPAN_RECEIVED_EVENT_TYPE,
          ),
        ).toBe(true);
        expect(context).toEqual({ tenantId: FIXTURE_TENANT_ID });
      });

      /** @scenario 'coalescing preserves every item' */
      it("keeps each span's idempotency key so a retry cannot duplicate it", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1].map((index) =>
          spanPayload({ spanId: spanId(index) }),
        );

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        const [events] = storeEventsFn.mock.calls[0]!;
        expect(
          (events as Event[]).map((event) => event.idempotencyKey),
        ).toEqual(
          payloads.map(
            (payload) =>
              `${FIXTURE_TENANT_ID}:${FIXTURE_TRACE_ID}:${payload.span.spanId}`,
          ),
        );
      });

      /** @scenario 'many items for one aggregate become one insert' */
      it("emits every span's event as a single trace aggregate", async () => {
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1, 2].map((index) =>
          spanPayload({ spanId: spanId(index) }),
        );

        await processCommandBatch(batchParamsFor({ payloads, storeEventsFn }));

        const [events] = storeEventsFn.mock.calls[0]!;
        expect(
          new Set((events as Event[]).map((event) => event.aggregateId)),
        ).toEqual(new Set([FIXTURE_TRACE_ID]));
      });
    });
  });

  // The spool is deleted only once the event carrying it is durable. Folding
  // must not turn that per-command guarantee into a per-batch one, or a batch
  // that fails after one span's spool was dropped could never be retried.
  describe("given spooled spans that reached the batch anyway", () => {
    describe("when the batch is stored", () => {
      it("deletes each span's spool once, after the single append", async () => {
        const order: string[] = [];
        const deleteSpool = vi.fn(
          async ({ spoolRef }: { spoolRef: string }) => {
            order.push(`delete:${spoolRef}`);
          },
        );
        const blobStore = {
          // The spool locates its object from the command's own trusted
          // tenant + span ids, so the stub takes the same named shape and
          // reads `spanId` directly rather than slicing it out of the ref.
          getSpool: async ({ spanId: id }: { spanId: string }) =>
            Buffer.from(
              JSON.stringify({
                span: spanPayload({ spanId: id }).span,
                resource: null,
                instrumentationScope: null,
              }),
              "utf-8",
            ),
          deleteSpool,
        };
        const storeEventsFn = vi.fn(async () => {
          order.push("store");
        });
        const payloads = [0, 1].map((index) =>
          spanPayload({
            spanId: spanId(index),
            spoolRef: `spool/${spanId(index)}`,
          }),
        );

        await processCommandBatch(
          batchParamsFor({
            payloads,
            storeEventsFn,
            handler: stubbedHandler(blobStore),
          }),
        );

        expect(storeEventsFn).toHaveBeenCalledTimes(1);
        expect(deleteSpool).toHaveBeenCalledTimes(2);
        expect(order).toEqual([
          "store",
          `delete:spool/${spanId(0)}`,
          `delete:spool/${spanId(1)}`,
        ]);
      });
    });

    describe("when a handler throws partway through the batch", () => {
      it("appends nothing and drops no spool, leaving the batch retryable", async () => {
        const deleteSpool = vi.fn().mockResolvedValue(undefined);
        const blobStore = {
          getSpool: vi.fn(async ({ spoolRef }: { spoolRef: string }) => {
            if (spoolRef.endsWith(spanId(1))) {
              throw new Error("spool fetch failed");
            }
            return Buffer.from(
              JSON.stringify({
                span: spanPayload({ spanId: spanId(0) }).span,
                resource: null,
                instrumentationScope: null,
              }),
              "utf-8",
            );
          }),
          deleteSpool,
        };
        const storeEventsFn = vi.fn().mockResolvedValue(undefined);
        const payloads = [0, 1].map((index) =>
          spanPayload({
            spanId: spanId(index),
            spoolRef: `spool/${spanId(index)}`,
          }),
        );

        await expect(
          processCommandBatch(
            batchParamsFor({
              payloads,
              storeEventsFn,
              handler: stubbedHandler(blobStore),
            }),
          ),
        ).rejects.toThrow("spool fetch failed");

        expect(storeEventsFn).not.toHaveBeenCalled();
        expect(deleteSpool).not.toHaveBeenCalled();
      });
    });
  });
});
