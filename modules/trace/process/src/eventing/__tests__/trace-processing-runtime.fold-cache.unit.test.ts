import { createTenantId } from "@langwatch/eventing";
/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-projections.feature
 */
import type { RedisConnection } from "@langwatch/redis-client";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { RedisTraceSummaryFoldCacheRepository } from "../../repositories/redis/redis.trace-summary-fold-cache.repository.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";

function compose() {
  const set = vi.fn(async (): Promise<"OK"> => "OK");
  const get = vi.fn(async () => null);
  const redis = createApiFixture<RedisConnection>({ get, set }, "redis");
  const pipeline = TraceProcessingRuntimeAdapter.create({
    role: "worker",
    tokenizer: createApiFixture<TraceProcessingPipelineInput["tokenizer"]>(),
    peers: createApiFixture<TraceProcessingPipelineInput["peers"]>({
      dataRetention: createApiFixture<TraceProcessingPipelineInput["peers"]["dataRetention"]>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
    }),
    repositories: {
      ...MemoryTraceRepositories.create(),
      summaryFoldCache: RedisTraceSummaryFoldCacheRepository.create(redis),
    },
    canonicalisation: TraceCanonicalisationService.create(),
    commands: createApiFixture<TraceProcessingPipelineInput["commands"]>(),
    findSummary: async () => null,
    recordTrackedEvent: async () => undefined,
    broadcast: createApiFixture<TraceProcessingPipelineInput["broadcast"]>(),
    milestones: createApiFixture<TraceProcessingPipelineInput["milestones"]>(),
  }).build({ participation: "consume" });
  return { pipeline, get, set };
}

const context = { aggregateId: "trace-1", tenantId: createTenantId("project-1") };

describe("TraceProcessingRuntimeAdapter", () => {
  describe("given the worker's trace pipeline built over the process's Redis", () => {
    /** @scenario "The worker's trace folds read through the Redis fold cache under main's keyspaces" */
    it("caches the traceSummary fold under main's keyspace", async () => {
      const { pipeline, set } = compose();
      const fold = pipeline.foldProjections.get("traceSummary");
      expect(fold, "the pipeline registered no traceSummary fold").toBeDefined();

      await fold?.open((definition) => definition.store.store(definition.init(), context));

      expect(set.mock.calls.map((call) => call.at(0))).toContain(
        "fold:trace_summaries:project-1:trace-1",
      );
    });

    /** @scenario "Trace's process installs without the trace analytics writers" */
    it("registers neither trace analytics lane nor a store for them, which analytics hosts", () => {
      const { pipeline } = compose();
      const repositories = Object.keys(MemoryTraceRepositories.create());

      expect(pipeline.foldProjections.has("traceAnalytics")).toBe(false);
      expect(pipeline.mapProjections.has("traceAnalyticsRollup")).toBe(false);
      expect(repositories.filter((name) => name.startsWith("analytics"))).toEqual([]);
    });

    /** @scenario "The worker's trace folds read through the Redis fold cache under main's keyspaces" */
    it("asks Redis first, then falls through to the durable projection on a miss", async () => {
      const { pipeline, get } = compose();
      const fold = pipeline.foldProjections.get("traceSummary");

      const read = await fold?.open((definition) => definition.store.get("trace-1", context));

      expect(get).toHaveBeenCalledWith("fold:trace_summaries:project-1:trace-1");
      expect(read).toMatchObject({ kind: "empty" });
    });
  });
});
