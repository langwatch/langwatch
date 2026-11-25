import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { createTestLogger } from "@langwatch/test-harness";
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { NonRetryableGroupQueueError } from "../errors.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { GroupQueueMetricsCollector } from "../metricsCollector.ts";
import { GroupStagingScripts } from "../scripts.ts";

type TestPayload = {
  id: string;
  groupId: string;
  __pipelineName: string;
  __jobType: string;
  __jobName: string;
};

const ROUTING = {
  pipeline_name: "trace_processing",
  job_type: "projection",
  job_name: "traceSummary",
};

/**
 * Drives a real queue into a blocked group, then reads the labels the alerts
 * group by: the non-retryable reason, and the blocked gauge resolved on Redis
 * from the group's head-job header (specs/queue-metric-labels.feature).
 */
describe("GroupQueueProcessor — metric labels", () => {
  const meter = createRecordingMeterProvider();
  let redis: Redis;
  const queues: GroupQueueProcessor<TestPayload>[] = [];
  const collectors: GroupQueueMetricsCollector[] = [];

  beforeAll(() => {
    meter.install();
    redis = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: 0,
    });
  });

  afterEach(async () => {
    for (const collector of collectors.splice(0)) collector.stop();
    await Promise.all(queues.splice(0).map((q) => q.close().catch(() => {})));
    const keys = await redis.keys("{test/gqlabels/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    meter.uninstall();
    await redis.quit();
  });

  describe("given a handler that throws a non-retryable error", () => {
    describe("when the job fails and its group is blocked", () => {
      /** @scenario "A non-retryable failure and its blocked group carry the job's pipeline and job" */
      it("counts the failure by reason and the blocked group by pipeline and job", async () => {
        const name = `{test/gqlabels/${crypto.randomUUID().slice(0, 8)}}`;
        const { logger } = createTestLogger();
        const queue = new GroupQueueProcessor<TestPayload>(
          {
            name,
            groupKey: (p) => p.groupId,
            identify: (p) => p.id,
            process: async () => {
              throw new NonRetryableGroupQueueError("bad payload");
            },
          },
          redis,
          { logger },
        );
        queues.push(queue);
        await queue.waitUntilReady();

        await queue.send({
          id: "job-1",
          groupId: "tenant-a/map/traceSummary/trace:1",
          __pipelineName: ROUTING.pipeline_name,
          __jobType: ROUTING.job_type,
          __jobName: ROUTING.job_name,
        });

        await vi.waitFor(
          () => {
            expect(
              meter.valueOf("gq_jobs_non_retryable_total", {
                queue_name: name,
                ...ROUTING,
                reason: "non_retryable_error",
              }),
            ).toBe(1);
          },
          { timeout: 15_000, interval: 50 },
        );

        const collector = new GroupQueueMetricsCollector({
          scripts: new GroupStagingScripts(redis, name),
          processingQueue: { length: () => 0 } as never,
          redisConnection: redis,
          queueName: name,
          activeJobCountFn: () => 0,
          metricsIntervalMs: 100,
          logger,
        });
        collectors.push(collector);
        collector.start();

        await vi.waitFor(
          () => {
            expect(
              meter.valuesOf("gq_blocked_groups", { queue_name: name, ...ROUTING }).at(-1),
            ).toBe(1);
          },
          { timeout: 15_000, interval: 50 },
        );
      });
    });
  });
});
