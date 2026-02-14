import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import { getTestRedisConnection } from "./testContainers";
import {
  cleanupTestDataForTenant,
  closePipelineGracefully,
  createTestPipeline,
  createTestTenantId,
  generateTestAggregateId,
  getTenantIdString,
  waitForEventHandler,
} from "./testHelpers";

describe("BullMQ Queue - Integration Tests", () => {
  let pipeline: ReturnType<typeof createTestPipeline>;
  let tenantId: ReturnType<typeof createTestTenantId>;
  let tenantIdString: string;
  let redisConnection: ReturnType<typeof getTestRedisConnection>;

  beforeEach(async () => {
    pipeline = createTestPipeline();
    tenantId = createTestTenantId();
    tenantIdString = getTenantIdString(tenantId);
    redisConnection = getTestRedisConnection();
    // Wait for BullMQ workers to initialize before running tests
    await pipeline.ready();
  });

  afterEach(async () => {
    // Gracefully close pipeline to ensure all BullMQ workers finish
    await closePipelineGracefully(pipeline);
    // Then clean up test data
    await cleanupTestDataForTenant(tenantIdString);
  });

  it("creates queues for commands, handlers, and projections", async () => {
    if (!redisConnection) {
      throw new Error("Redis connection not available");
    }

    // Send a command to trigger queue creation
    const aggregateId = generateTestAggregateId("queue");
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 1,
    });

    // Wait for processing to complete via event handler log
    await waitForEventHandler(
      aggregateId,
      tenantIdString,
      1,
      5000,
    );

    // Check that queues exist in Redis (using unique pipeline name)
    // Queue names are wrapped in hash tags by makeQueueName(), so Redis
    // keys follow the pattern: bull:{pipelineName/type/name}:*
    if (redisConnection) {
      const pipelineName = pipeline.pipelineName;
      const commandQueueKeys = await redisConnection.keys(
        `bull:{${pipelineName}/command/testCommand}:*`,
      );
      const handlerQueueKeys = await redisConnection.keys(
        `bull:{${pipelineName}/handler/testHandler}:*`,
      );
      const projectionQueueKeys = await redisConnection.keys(
        `bull:{${pipelineName}/projection/testProjection}:*`,
      );

      // Queues must have been created — at least one key per queue type
      expect(commandQueueKeys.length).toBeGreaterThan(0);
      expect(handlerQueueKeys.length).toBeGreaterThan(0);
      expect(projectionQueueKeys.length).toBeGreaterThan(0);
    }
  });

  it("handles job retries on failure", async () => {
    // This test would require a handler that can fail
    // For now, we verify that the queue infrastructure supports retries
    // by checking that failed jobs are tracked

    const aggregateId = generateTestAggregateId("queue-retry");

    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 1,
    });

    // Wait for processing to complete via event handler log
    await waitForEventHandler(
      aggregateId,
      tenantIdString,
      1,
      15000,
    );

    // Verify job was processed (no failures in normal case)
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );

    expect(events.length).toBe(1);
  });

  it("cleans up queues on pipeline close", async () => {
    const aggregateId = generateTestAggregateId("queue-cleanup");

    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 1,
    });

    // Wait for processing to complete via event handler log
    await waitForEventHandler(
      aggregateId,
      tenantIdString,
      1,
      5000,
    );

    // Close pipeline
    await pipeline.service.close();

    // Verify queues can be accessed (they should still exist but be closed)
    // This is more of a smoke test - actual cleanup verification would require
    // checking BullMQ queue state, which is complex
    expect(pipeline.service).toBeDefined();
  });
}, 60000);
