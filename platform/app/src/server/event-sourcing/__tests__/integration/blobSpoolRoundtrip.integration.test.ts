import type { StagedJob } from "@langwatch/event-sourcing";
import {
  DEFAULT_INLINE_BODY_THRESHOLD_BYTES,
  LANE_REGISTRY_KEY,
  redisBlobSpool,
  redisLaneQueue,
} from "@langwatch/groupqueue";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { simulationRunFoldGroupKey } from "~/server/event-sourcing/simulation-processing";
import {
  startTestContainers,
  stopTestContainers,
} from "~/test-utils/integration/testContainers";
import { cleanupLane } from "./support/redisLaneCleanup";

/**
 * ADR-108 decision 9: a body over the inline threshold is offloaded to the
 * spool and the job carries a reference instead. The queue and the "consumer"
 * step below share one spool instance — a fresh one would never see the blob
 * the queue put there.
 */
describe("given a job body larger than the inline threshold", () => {
  const suffix = nanoid(8);
  const tenantId = `tenant-blob-spool-${suffix}`;
  const scenarioRunId = `run-${suffix}`;
  const key = simulationRunFoldGroupKey({ tenantId, scenarioRunId });
  const largeBody = JSON.stringify({
    scenarioRunId,
    filler: "x".repeat(DEFAULT_INLINE_BODY_THRESHOLD_BYTES * 2),
  });

  let containers: Awaited<ReturnType<typeof startTestContainers>>;
  let queue: ReturnType<typeof redisLaneQueue>;
  let spool: ReturnType<typeof redisBlobSpool>;

  beforeAll(async () => {
    containers = await startTestContainers();
    await containers.redisConnection.del(LANE_REGISTRY_KEY);
    spool = redisBlobSpool(containers.redisConnection);
    queue = redisLaneQueue(containers.redisConnection, spool);

    const job: StagedJob = {
      descriptor: key,
      orderingKey: 1,
      aggregateId: scenarioRunId,
      eventType: "lw.simulation_run.queued",
      eventId: "event-1",
      costBytes: Buffer.byteLength(largeBody),
      body: largeBody,
    };
    await queue.stage([job]);
  }, 120_000);

  afterAll(async () => {
    await cleanupLane(containers.redisConnection, key);
    await stopTestContainers();
  }, 120_000);

  it("round-trips the body byte-identical through the spool", async () => {
    const batch = await queue.claim({
      maxJobs: 1,
      maxBytes: 1_000_000_000,
      leaseMs: 5_000,
    });
    const job = batch?.jobs[0];

    expect(job?.header.blobRef).toBeDefined();
    expect(job?.body).toBe("");

    const resolved = await spool.get(job!.header.blobRef!);
    expect(resolved).toBe(largeBody);

    await queue.settle(batch!.lease);
    await spool.release(job!.header.blobRef!);
  });
});
