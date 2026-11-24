import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";

import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import IORedis, { type Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupQueueRuntimeDefinition } from "../contracts.ts";
import { GroupQueueProcessor } from "../groupQueue.ts";
import { RedisJobBlobStore } from "../redisJobBlobStore.ts";
import { GroupStagingScripts } from "../scripts.ts";
import { InMemoryObjectStore, mintTestUri } from "./blob-test-doubles.ts";

type TestPayload = {
  id: string;
  groupId: string;
  value: string;
  __pipelineName?: string;
  __jobType?: string;
  __jobName?: string;
};

// A job exactly as a 3.20.1 worker staged it with envelope writes off (#9840):
// `JSON.stringify(jobData)`, routing and machinery as `__*` keys in the body.
const TENANT = "proj1";
const ROUTING = {
  __pipelineName: "trace_processing",
  __jobType: "projection",
  __jobName: "traceSummary",
};
const PAUSE_KEY = "trace_processing/projection/traceSummary";

function legacyBareJson({ id, groupId }: { id: string; groupId: string }): string {
  return JSON.stringify({
    id,
    groupId,
    value: "staged-by-3.20.1",
    ...ROUTING,
    __context: { traceId: "t1" },
  });
}

function legacyGq1({ id, groupId }: { id: string; groupId: string }): string {
  const json = legacyBareJson({ id, groupId });
  const header = JSON.stringify({
    v: 1,
    e: "j",
    p: ROUTING.__pipelineName,
    t: ROUTING.__jobType,
    n: ROUTING.__jobName,
    s: Buffer.byteLength(json),
  });
  return `GQ1|${Buffer.byteLength(header)}|${header}${json}`;
}

/** GQ1 with the body offloaded whole, gzip, to the queue's blob keys, as 3.20.1 did over 32 KiB. */
async function legacyGq1Ref({
  id,
  groupId,
  redis,
  name,
}: {
  id: string;
  groupId: string;
  redis: Redis;
  name: string;
}): Promise<string> {
  const json = legacyBareJson({ id, groupId });
  const blobId = randomUUID();
  await new RedisJobBlobStore({ redis, queueName: name }).put({ id: blobId, data: gzipSync(json) });
  const header = JSON.stringify({
    v: 1,
    e: "ref",
    r: blobId,
    p: ROUTING.__pipelineName,
    t: ROUTING.__jobType,
    n: ROUTING.__jobName,
    s: Buffer.byteLength(json),
  });
  return `GQ1|${Buffer.byteLength(header)}|${header}`;
}

type Encode = (input: {
  id: string;
  groupId: string;
  redis: Redis;
  name: string;
}) => string | Promise<string>;

describe("GroupQueueProcessor, jobs staged by 3.20.1 (#9840)", () => {
  let redis: Redis;
  let queues: GroupQueueProcessor<TestPayload>[];
  const meter = createRecordingMeterProvider();

  beforeAll(() => {
    meter.install();
    redis = new IORedis(
      process.env.LANGWATCH_TEST_REDIS_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379",
      { maxRetriesPerRequest: 0 },
    );
  });

  beforeEach(() => {
    queues = [];
  });

  afterEach(async () => {
    await Promise.all(queues.map((q) => q.close().catch(() => {})));
    const keys = await redis.keys("{test/gqlegacy/*");
    if (keys.length > 0) await redis.del(...keys);
  });

  afterAll(async () => {
    meter.uninstall();
    await redis.quit();
  });

  const freshName = () => `{test/gqlegacy/${crypto.randomUUID().slice(0, 8)}}`;

  function stageRaw({
    name,
    groupId,
    stagedJobId,
    jobDataJson,
  }: {
    name: string;
    groupId: string;
    stagedJobId: string;
    jobDataJson: string;
  }) {
    return new GroupStagingScripts(redis, name).stage({
      stagedJobId,
      groupId,
      dispatchAfterMs: Date.now() - 1000,
      dedupId: "",
      dedupTtlMs: 0,
      jobDataJson,
      shouldExtend: true,
      shouldReplace: true,
    });
  }

  const recorded = (name: string, instrument: string) =>
    meter.recorded.filter((r) => r.instrument === instrument && r.attributes.queue_name === name);

  const formats: { format: string; encode: Encode }[] = [
    { format: "bare JSON", encode: legacyBareJson },
    { format: "a GQ1 inline envelope", encode: legacyGq1 },
    { format: "a GQ1 envelope with its body in the queue's blob keys", encode: legacyGq1Ref },
  ];
  for (const { format, encode } of formats) {
    describe(`given a job the old worker staged as ${format}`, () => {
      describe("when the new worker claims it", () => {
        /** @scenario "A job staged by 3.20.1 runs on the current worker instead of being dropped" */
        it("runs the handler with the payload and routing labels, and drops nothing", async () => {
          const name = freshName();
          const groupId = `${TENANT}/legacy`;
          await stageRaw({
            name,
            groupId,
            stagedJobId: "legacy-1",
            jobDataJson: await encode({ id: "legacy-1", groupId, redis, name }),
          });

          const received: TestPayload[] = [];
          const definition: GroupQueueRuntimeDefinition<TestPayload> = {
            name,
            groupKey: (p) => p.groupId,
            identify: (p) => p.id,
            process: async (p) => {
              received.push(p);
            },
          };
          const queue = new GroupQueueProcessor<TestPayload>(definition, redis, {
            consumerEnabled: true,
            objectStoreFor: () => new InMemoryObjectStore(),
            mintUri: mintTestUri,
            resolveStorageDestination: async () => ({ kind: "s3" as const, bucket: "b" }),
          });
          queues.push(queue);

          await vi.waitFor(() => expect(received).toHaveLength(1), {
            timeout: 10000,
            interval: 50,
          });
          expect(received[0]).toEqual({
            id: "legacy-1",
            groupId,
            value: "staged-by-3.20.1",
            ...ROUTING,
          });
          await vi.waitFor(() =>
            expect(recorded(name, "gq_jobs_completed_total")[0]?.attributes).toMatchObject({
              pipeline_name: "trace_processing",
              job_type: "projection",
              job_name: "traceSummary",
            }),
          );
          expect(recorded(name, "gq_jobs_dropped_total")).toHaveLength(0);
        });
      });

      describe("when its lane is paused", () => {
        /** @scenario "Dispatch reads the routing of a job staged by 3.20.1" */
        it("parks the group under the paused lane instead of dispatching it", async () => {
          const name = freshName();
          const groupId = `${TENANT}/legacy-paused`;
          await stageRaw({
            name,
            groupId,
            stagedJobId: "legacy-p",
            jobDataJson: await encode({ id: "legacy-p", groupId, redis, name }),
          });
          const scripts = new GroupStagingScripts(redis, name);
          await scripts.addPauseKey(PAUSE_KEY);

          const dispatched = await scripts.dispatch({ nowMs: Date.now(), activeTtlSec: 60 });

          expect(dispatched).toBeNull();
          expect(await redis.zrange(`${name}:gq:parked-lane:${PAUSE_KEY}`, 0, -1)).toEqual([
            groupId,
          ]);
        });
      });
    });
  }
});
