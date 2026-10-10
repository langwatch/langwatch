/**
 * The annotation commands edit one trace's annotation set, so they apply in
 * order. On per-command groups a delete could run before its add and leave the
 * deleted id searchable under `has:annotation`.
 */
import { describe, expect, it } from "vitest";

import { createTraceProcessingProducerPipeline } from "../trace-processing-producer.pipeline.ts";
import { EventingTraceProcessingAdapter } from "../trace-processing.commands.ts";

const ANNOTATION_COMMANDS = ["addAnnotation", "removeAnnotation", "bulkSyncAnnotations"] as const;

function commandNamed(name: string) {
  const entry = createTraceProcessingProducerPipeline({ role: "api" }).commands.find(
    (command) => command.definition.name === name,
  );
  if (!entry) throw new Error(`no command registered as "${name}"`);
  return entry;
}

const adapter = EventingTraceProcessingAdapter.create();
const AGGREGATE_ID_OF = {
  addAnnotation: (payload: never) => adapter.addAnnotationCommand.getAggregateId(payload),
  removeAnnotation: (payload: never) => adapter.removeAnnotationCommand.getAggregateId(payload),
  bulkSyncAnnotations: (payload: never) =>
    adapter.bulkSyncAnnotationsCommand.getAggregateId(payload),
} as const;

function aggregateIdOf(name: keyof typeof AGGREGATE_ID_OF, payload: Record<string, unknown>) {
  return AGGREGATE_ID_OF[name](payload as never);
}

describe("given the trace-processing pipeline", () => {
  describe("when the annotation commands are registered", () => {
    it.each(ANNOTATION_COMMANDS)("%s serializes on the trace", (name) => {
      expect(commandNamed(name).definition.options?.serializeByAggregate).toBe(true);
    });

    it.each(ANNOTATION_COMMANDS)("%s declares no group key of its own", (name) => {
      expect(commandNamed(name).definition.options?.getGroupKey).toBeUndefined();
    });
  });

  describe("when an add, a remove and a bulk sync target one trace", () => {
    it("resolves all three to the same aggregate, so one lane", () => {
      const target = { tenantId: "tenant_1", traceId: "trace_same" };

      const ids = new Set([
        aggregateIdOf("addAnnotation", { ...target, annotationId: "ann_1" }),
        aggregateIdOf("removeAnnotation", { ...target, annotationId: "ann_1" }),
        aggregateIdOf("bulkSyncAnnotations", { ...target, annotationIds: ["ann_1"] }),
      ]);

      expect(ids.size).toBe(1);
    });
  });

  describe("when the same command targets two different traces", () => {
    it("keeps them on separate aggregates so traces still run concurrently", () => {
      expect(
        aggregateIdOf("addAnnotation", {
          tenantId: "tenant_1",
          traceId: "trace_a",
          annotationId: "ann_1",
        }),
      ).not.toBe(
        aggregateIdOf("addAnnotation", {
          tenantId: "tenant_1",
          traceId: "trace_b",
          annotationId: "ann_1",
        }),
      );
    });
  });
});
