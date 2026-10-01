/**
 * @vitest-environment node
 * Spec: modules/trace/specs/trace-projections.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { createTenantId } from "@langwatch/eventing";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import { describe, expect, it, vi } from "vitest";

import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { RedisTraceAnalyticsFoldCacheRepository } from "../../repositories/redis/redis.trace-analytics-fold-cache.repository.ts";
import { RedisTraceSummaryFoldCacheRepository } from "../../repositories/redis/redis.trace-summary-fold-cache.repository.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import {
  type TraceProcessingPipelineInput,
  TraceProcessingRuntimeAdapter,
} from "../trace-processing-runtime.pipeline.ts";

function compose() {
  const set = vi.fn(async (): Promise<"OK"> => "OK");
  const get = vi.fn(async () => null);
  const redis = createApiFixture<ProcessMembers["redis"]>({ get, set }, "redis");
  const pipeline = TraceProcessingRuntimeAdapter.create({
    processName: "langwatch-test",
    tokenizer: createApiFixture<TraceProcessingPipelineInput["tokenizer"]>(),
    peers: createApiFixture<TraceProcessingPipelineInput["peers"]>({
      dataRetention: createApiFixture<TraceProcessingPipelineInput["peers"]["dataRetention"]>({
        getPlatformDefaultRetentionDays: () => 30,
      }),
    }),
    repositories: {
      ...MemoryTraceRepositories.create(),
      summaryFoldCache: RedisTraceSummaryFoldCacheRepository.create(redis),
      analyticsFoldCache: RedisTraceAnalyticsFoldCacheRepository.create(redis),
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
    it.each([
      ["traceSummary", "fold:trace_summaries:project-1:trace-1"],
      ["traceAnalytics", "fold:trace_analytics:project-1:trace-1"],
    ])("caches the %s fold under main's keyspace", async (foldName, expectedKey) => {
      const { pipeline, set } = compose();
      const fold = pipeline.foldProjections.get(foldName);
      expect(fold, `the pipeline registered no ${foldName} fold`).toBeDefined();

      await fold?.open((definition) => definition.store.store(definition.init(), context));

      expect(set.mock.calls.map((call) => call.at(0))).toContain(expectedKey);
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
