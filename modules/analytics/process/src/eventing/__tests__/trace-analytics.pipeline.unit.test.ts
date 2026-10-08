import { createTenantId } from "@langwatch/eventing";
/**
 * @vitest-environment node
 * Spec: modules/analytics/specs/trace-analytics-ownership.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryAnalyticsRepositories } from "../../repositories/memory/memory.analytics.repositories.ts";
import { RedisTraceAnalyticsFoldCacheRepository } from "../../repositories/redis/redis.trace-analytics-fold-cache.repository.ts";
import {
  buildTraceAnalyticsPipeline,
  TRACE_ANALYTICS_PIPELINE_NAME,
  type TraceAnalyticsRetention,
} from "../trace-analytics.pipeline.ts";

type RedisConnection = Parameters<typeof RedisTraceAnalyticsFoldCacheRepository.create>[0];

const RESOLVED = { traces: 400, scenarios: 400, experiments: 400 };

function compose() {
  const set = vi.fn(async (): Promise<"OK"> => "OK");
  const get = vi.fn(async () => null);
  const redis = createApiFixture<RedisConnection>({ get, set }, "redis");
  const getResolvedForProject = vi.fn(async () => RESOLVED);
  const pipeline = buildTraceAnalyticsPipeline({
    repositories: {
      ...MemoryAnalyticsRepositories.create(),
      traceAnalyticsFoldCache: RedisTraceAnalyticsFoldCacheRepository.create(redis),
    },
    retention: createApiFixture<TraceAnalyticsRetention>({
      getPlatformDefaultRetentionDays: () => 30,
      getResolvedForProject,
    }),
  });
  return { pipeline, set, getResolvedForProject };
}

const context = { aggregateId: "trace-1", tenantId: createTenantId("project-1") };

describe("the trace_analytics host pipeline", () => {
  describe("given it is built over the process's Redis and the retention peer", () => {
    /** @scenario "Analytics hosts the trace analytics fold and rollup as peer lanes on trace's facts" */
    it("hosts the slim fold and the per-span rollup as peer lanes", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe(TRACE_ANALYTICS_PIPELINE_NAME);
      expect(pipeline.foldProjections.size + pipeline.mapProjections.size).toBe(0);
      expect(pipeline.globalProjections?.map((lane) => [lane.name, lane.peer?.kind])).toEqual([
        ["trace_analytics.traceAnalytics", "fold"],
        ["trace_analytics.traceAnalyticsRollup", "map"],
      ]);
    });

    /** @scenario "Analytics' trace_analytics fold reads through the Redis fold cache under main's keyspace" */
    it("caches the slim fold under main's trace_analytics keyspace", async () => {
      const { pipeline, set } = compose();
      const lane = pipeline.globalProjections?.find((each) =>
        each.name.endsWith(".traceAnalytics"),
      );
      if (lane?.peer?.kind !== "fold") throw new Error("no traceAnalytics peer fold");

      await lane.peer.projection.open((definition) =>
        definition.store.store(definition.init(), context),
      );

      expect(set.mock.calls.map((call) => call.at(0))).toContain(
        "fold:trace_analytics:project-1:trace-1",
      );
    });

    /** @scenario "Analytics' trace analytics lanes stamp each row with its project's retention" */
    it("resolves each project's retention through the retention peer", async () => {
      const { pipeline, getResolvedForProject } = compose();

      const resolved = await pipeline.retentionPolicyResolver?.resolve("project-1");

      expect(getResolvedForProject).toHaveBeenCalledWith({ projectId: "project-1" });
      expect(resolved).toEqual(RESOLVED);
    });
  });
});
