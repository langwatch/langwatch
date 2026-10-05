/**
 * @vitest-environment node
 * A tracked event is recorded as a synthetic span through the same ingress command a span uses.
 * Spec: specs/trace-processing/worker-trace-pipeline-conversion.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  TRACK_EVENT_SPAN_NAME,
  type TrackEventRESTParamsValidator,
} from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { TraceModule, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

function app({ recordSpan }: { recordSpan: TraceSpanIngestRecord }) {
  return TraceModule.create(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
      spanIngest: createApiFixture<NonNullable<TraceAppDependencies["spanIngest"]>>({ recordSpan }),
    }),
  );
}

type TraceSpanIngestRecord = NonNullable<TraceAppDependencies["spanIngest"]>["recordSpan"];

const THUMBS_UP: TrackEventRESTParamsValidator = {
  trace_id: "trace-1",
  event_type: "thumbs_up_down",
  metrics: { vote: 1 },
};

describe("TraceModule.recordTrackedEvent", () => {
  describe("given a span carrying a thumbs-up the customer left", () => {
    describe("when the tracked event is recorded", () => {
      /** @scenario Live span feedback is recorded as a tracked event */
      it("mints a span for the rating and records it, carrying the type, the id and the rating", async () => {
        const recordSpan = vi.fn<TraceSpanIngestRecord>(async () => undefined);

        await app({ recordSpan }).recordTrackedEvent({
          project: { id: "project-1" },
          body: THUMBS_UP,
          eventId: "event-1",
        });

        expect(recordSpan).toHaveBeenCalledTimes(1);
        const recorded = recordSpan.mock.calls[0]![0];
        expect(recorded.tenantId).toBe("project-1");
        expect(recorded.instrumentationScope).toEqual({ name: TRACK_EVENT_SPAN_NAME });
        expect(recorded.span.traceId).toBe("trace-1");
        expect(recorded.span.name).toBe(TRACK_EVENT_SPAN_NAME);
        const attributes = new Map(
          recorded.span.attributes.map((attribute) => [attribute.key, attribute.value]),
        );
        expect(attributes.get("event.type")).toEqual({ stringValue: "thumbs_up_down" });
        expect(attributes.get("event.id")).toEqual({ stringValue: "event-1" });
        expect(attributes.get("event.metrics.vote")).toEqual({ doubleValue: 1 });
      });
    });
  });
});
