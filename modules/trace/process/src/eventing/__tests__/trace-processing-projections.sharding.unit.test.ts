/**
 * @vitest-environment node
 * Spec: modules/trace/specs/span-command-sharding.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { OtlpSpan, RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { EventingRecordSpanAdapter } from "../record-span.commands.ts";
import {
  EventingTracePipelineAdapter,
  type EventingTracePipelineAdapterOptions,
} from "../trace-processing-projections.pipeline.ts";

type Options = EventingTracePipelineAdapterOptions;

const TRACE_ID = "534bd8a1bf83e7c58e8aaacefb047cc2";

function recordSpanPayload(spanId: string): RecordSpanCommandData {
  const span: OtlpSpan = {
    traceId: TRACE_ID,
    spanId,
    name: "test-span",
    kind: 1,
    startTimeUnixNano: { low: 0, high: 0 },
    endTimeUnixNano: { low: 0, high: 0 },
    attributes: [],
    events: [],
    links: [],
    status: { message: null, code: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
  };
  return { tenantId: "project-1", span, resource: null, instrumentationScope: null, occurredAt: 1 };
}

function pipeline({ spanCommandShardCount }: { spanCommandShardCount: number }) {
  const canonicalisation = TraceCanonicalisationService.create();
  return EventingTracePipelineAdapter.create({
    spanStore: createApiFixture<Options["spanStore"]>(),
    summaryStore: createApiFixture<Options["summaryStore"]>(),
    derivedStore: createApiFixture<Options["derivedStore"]>(),
    rollupStore: createApiFixture<Options["rollupStore"]>(),
    canonicalisation,
    ioExtraction: createApiFixture<Options["ioExtraction"]>(),
    mediaReferences: createApiFixture<Options["mediaReferences"]>(),
    modelCosts: createApiFixture<Options["modelCosts"]>(),
    spanNormalization: createApiFixture<Options["spanNormalization"]>(),
    prepareEventForProjection: (event) => event,
    recordSpanCommand: createApiFixture<EventingRecordSpanAdapter>(),
    spanCommandShardCount,
  })
    .build()
    .build();
}

function missing(name: string): never {
  throw new Error(`the recordSpan registration has no ${name}`);
}

function recordSpanRegistration({ spanCommandShardCount }: { spanCommandShardCount: number }) {
  const sealed = pipeline({ spanCommandShardCount }).commands.find(
    (command) => command.definition.name === "recordSpan",
  );
  if (!sealed) throw new Error("the pipeline registered no recordSpan command");
  return sealed;
}

describe("the trace processing pipeline's recordSpan command", () => {
  describe("given the pipeline is built with several shards", () => {
    describe("when the group key is derived for two different spans of one trace", () => {
      /** @scenario The pipeline shards the command while leaving the fold per-trace */
      it("lets the two spans resolve to different groups while both stay one trace's aggregate", () => {
        const sealed = recordSpanRegistration({ spanCommandShardCount: 8 });
        const spanIds = Array.from({ length: 64 }, (_, i) =>
          (i + 1).toString(16).padStart(16, "0"),
        );

        // The registration is typed over an unknown payload, so the calls go through apply.
        const { groups, handledByRecordSpanAdapter } = sealed.open((registration) => ({
          groups: new Set(
            spanIds.map((spanId) =>
              Reflect.apply(
                registration.options?.getGroupKey ?? missing("getGroupKey"),
                undefined,
                [recordSpanPayload(spanId)],
              ),
            ),
          ),
          handledByRecordSpanAdapter: Object.is(
            registration.handlerClass,
            EventingRecordSpanAdapter,
          ),
        }));

        expect(groups.size).toBeGreaterThan(1);
        for (const group of groups) expect(group?.startsWith(`${TRACE_ID}:`)).toBe(true);
        expect(handledByRecordSpanAdapter).toBe(true);
        for (const spanId of spanIds) {
          expect(EventingRecordSpanAdapter.getAggregateId(recordSpanPayload(spanId))).toBe(
            TRACE_ID,
          );
        }
      });
    });
  });
});
