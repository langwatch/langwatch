/**
 * The annotation commands edit one trace's annotation set, so they must apply
 * to it in order. Left on per-command queue groups, a delete issued right after
 * a create could be applied first, find nothing to remove, and let the later
 * add leave the deleted id searchable under `has:annotation`.
 *
 * Asserted through the real QueueManager: an option that never reaches the
 * registry looks exactly like one that does.
 */
import { describe, expect, it, vi } from "vitest";
import type { JobRegistryEntry } from "../../../services/queues/queueManager";
import { QueueManager } from "../../../services/queues/queueManager";
import { createTraceProcessingPipeline } from "../pipeline";
import { buildTraceDeps } from "./support/traceProcessingFixtures";

const ANNOTATION_COMMANDS = [
  "addAnnotation",
  "removeAnnotation",
  "bulkSyncAnnotations",
] as const;

function registrationOf(name: string) {
  const entry = createTraceProcessingPipeline(buildTraceDeps()).commands.find(
    (candidate) => candidate.name === name,
  );
  if (!entry) throw new Error(`no command registered as "${name}"`);
  return entry;
}

function registry() {
  const globalJobRegistry = new Map<string, JobRegistryEntry>();
  const manager = new QueueManager({
    aggregateType: "trace",
    pipelineName: "trace_processing",
    globalQueue: {
      send: vi.fn().mockResolvedValue(void 0),
      sendBatch: vi.fn().mockResolvedValue(void 0),
      close: vi.fn().mockResolvedValue(void 0),
      waitUntilReady: vi.fn().mockResolvedValue(void 0),
    } as never,
    globalJobRegistry,
  });
  manager.initializeCommandQueues(
    ANNOTATION_COMMANDS.map(registrationOf) as never,
    vi.fn(),
    "trace_processing",
  );
  return globalJobRegistry;
}

function groupKeyOf(name: string, payload: Record<string, unknown>) {
  const entry = registry().get(`trace_processing:command:${name}`);
  if (!entry) throw new Error(`no job registered for "${name}"`);
  return entry.groupKeyFn(payload);
}

describe("given the trace-processing pipeline", () => {
  describe("when the annotation commands are registered", () => {
    it.each(ANNOTATION_COMMANDS)("%s serializes on the trace", (name) => {
      expect(registrationOf(name).options?.serializeByAggregate).toBe(true);
    });
  });

  describe("when an add, a remove and a bulk sync target one trace", () => {
    it("routes all three to the same queue group", () => {
      const target = { tenantId: "tenant_1", traceId: "trace_same" };

      const keys = new Set([
        groupKeyOf("addAnnotation", { ...target, annotationId: "ann_1" }),
        groupKeyOf("removeAnnotation", { ...target, annotationId: "ann_1" }),
        groupKeyOf("bulkSyncAnnotations", {
          ...target,
          annotationIds: ["ann_1"],
        }),
      ]);

      expect(keys.size).toBe(1);
    });
  });

  describe("when the same command targets two different traces", () => {
    it("keeps them on separate groups so traces still run concurrently", () => {
      expect(
        groupKeyOf("addAnnotation", {
          tenantId: "tenant_1",
          traceId: "trace_a",
          annotationId: "ann_1",
        }),
      ).not.toBe(
        groupKeyOf("addAnnotation", {
          tenantId: "tenant_1",
          traceId: "trace_b",
          annotationId: "ann_1",
        }),
      );
    });
  });
});
