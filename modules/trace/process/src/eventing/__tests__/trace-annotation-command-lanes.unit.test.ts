/**
 * The annotation commands edit one trace's annotation set, so they share its
 * lane. Asserted through the real QueueManager: an option that never reaches
 * the registry looks exactly like one that does.
 */
import { type EventSourcedQueueProcessor, type JobRegistryEntry } from "@langwatch/eventing";
import { QueueManager } from "@langwatch/eventing/testing";
import { describe, expect, it, vi } from "vitest";

import { createTraceProcessingProducerPipeline } from "../trace-processing-producer.pipeline.ts";

const ANNOTATION_COMMANDS = ["addAnnotation", "removeAnnotation", "bulkSyncAnnotations"] as const;

function sharedQueue(): EventSourcedQueueProcessor<Record<string, unknown>> {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

function pipeline() {
  return createTraceProcessingProducerPipeline({ processName: "lane-test" });
}

function registration(name: string) {
  const entry = pipeline().commands.find((command) => command.definition.name === name);
  if (!entry) throw new Error(`no command registered as "${name}"`);
  return entry;
}

function wiredRegistry(): Map<string, JobRegistryEntry> {
  const definition = pipeline();
  const registry = new Map<string, JobRegistryEntry>();
  const manager = new QueueManager({
    parseEvent: definition.parseEvent,
    aggregateType: "trace",
    pipelineName: "trace_processing",
    globalQueue: sharedQueue(),
    globalJobRegistry: registry,
  });
  manager.initializeCommandQueues(
    definition.commands.filter((command) =>
      ANNOTATION_COMMANDS.some((name) => name === command.definition.name),
    ),
    vi.fn(),
    "trace_processing",
  );
  return registry;
}

function groupKeyOf(name: string, payload: Record<string, unknown>): string {
  const entry = wiredRegistry().get(`trace_processing:command:${name}`);
  if (!entry) throw new Error(`no job registered for "${name}"`);
  return entry.route({ occurredAt: 1_000, ...payload }).groupKey;
}

describe("given the trace-processing pipeline", () => {
  describe("when the annotation commands are registered", () => {
    it.each(ANNOTATION_COMMANDS)("%s serializes on the trace", (name) => {
      expect(registration(name).definition.options?.serializeByAggregate).toBe(true);
    });
  });

  describe("when an add, a remove and a bulk sync target one trace", () => {
    it("routes all three to the same queue group", () => {
      const target = { tenantId: "tenant_1", traceId: "trace_same" };

      const keys = new Set([
        groupKeyOf("addAnnotation", { ...target, annotationId: "ann_1" }),
        groupKeyOf("removeAnnotation", { ...target, annotationId: "ann_1" }),
        groupKeyOf("bulkSyncAnnotations", { ...target, annotationIds: ["ann_1"] }),
      ]);

      expect(keys.size).toBe(1);
    });
  });

  describe("when the same command targets two different traces", () => {
    it("keeps them on separate groups so traces still run concurrently", () => {
      const onTrace = (traceId: string) =>
        groupKeyOf("addAnnotation", { tenantId: "tenant_1", traceId, annotationId: "ann_1" });

      expect(onTrace("trace_a")).not.toBe(onTrace("trace_b"));
    });
  });
});
