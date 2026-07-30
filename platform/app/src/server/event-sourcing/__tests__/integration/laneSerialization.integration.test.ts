import type { StagedJob } from "@langwatch/event-sourcing";
import { renderGroupKey } from "@langwatch/event-sourcing";
import {
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
 * ADR-108 decision 4 against real Redis: a lane's lease blocks a second
 * claim until the first delivery settles, so two deliveries for the same
 * aggregate can never be applied concurrently.
 */
describe("given two deliveries staged onto the same aggregate lane", () => {
  const suffix = nanoid(8);
  const tenantId = `tenant-lane-serialization-${suffix}`;
  const scenarioRunId = `run-${suffix}`;
  const key = simulationRunFoldGroupKey({ tenantId, scenarioRunId });
  const renderedKey = renderGroupKey(key);

  let containers: Awaited<ReturnType<typeof startTestContainers>>;
  let queue: ReturnType<typeof redisLaneQueue>;

  beforeAll(async () => {
    containers = await startTestContainers();
    // groupqueue:lanes has no other adopter yet; files run serially, so
    // resetting it before staging keeps the claim scan scoped to this lane.
    await containers.redisConnection.del(LANE_REGISTRY_KEY);
    const spool = redisBlobSpool(containers.redisConnection);
    queue = redisLaneQueue(containers.redisConnection, spool);

    const jobFor = (eventId: string, orderingKey: number): StagedJob => ({
      descriptor: key,
      orderingKey,
      aggregateId: scenarioRunId,
      eventType: "lw.simulation_run.queued",
      eventId,
      costBytes: 16,
      body: JSON.stringify({ eventId }),
    });
    await queue.stage([jobFor("delivery-1", 1), jobFor("delivery-2", 2)]);
  }, 120_000);

  afterAll(async () => {
    await cleanupLane(containers.redisConnection, key);
    await stopTestContainers();
  }, 120_000);

  it("keeps the lane unclaimable until the first delivery settles", async () => {
    const claimRequest = { maxJobs: 1, maxBytes: 1_000_000, leaseMs: 5_000 };

    const first = await queue.claim(claimRequest);
    expect(first?.lease.groupKey).toBe(renderedKey);
    expect(first?.jobs).toHaveLength(1);
    expect(first?.jobs[0]?.header.eventId).toBe("delivery-1");

    const whileLeased = await queue.claim(claimRequest);
    expect(whileLeased).toBeNull();

    await queue.settle(first!.lease);

    const second = await queue.claim(claimRequest);
    expect(second?.lease.groupKey).toBe(renderedKey);
    expect(second?.jobs).toHaveLength(1);
    expect(second?.jobs[0]?.header.eventId).toBe("delivery-2");

    await queue.settle(second!.lease);
  });
});
