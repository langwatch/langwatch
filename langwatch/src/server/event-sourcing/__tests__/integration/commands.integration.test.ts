import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDataForTenant,
  closePipelineGracefully,
  createTestPipeline,
  createTestTenantId,
  generateTestAggregateId,
  getTenantIdString,
  waitForCheckpoint,
} from "./testHelpers";

describe("Command Processing - Integration Tests", () => {
  let pipeline: ReturnType<typeof createTestPipeline>;
  let tenantId: ReturnType<typeof createTestTenantId>;
  let tenantIdString: string;

  beforeEach(async () => {
    pipeline = createTestPipeline();
    tenantId = createTestTenantId();
    tenantIdString = getTenantIdString(tenantId);
    // Wait for BullMQ workers to initialize before running tests
    await pipeline.ready();
  });

  afterEach(async () => {
    // Gracefully close pipeline to ensure all BullMQ workers finish
    await closePipelineGracefully(pipeline);
    // Then clean up test data
    await cleanupTestDataForTenant(tenantIdString);
  });

  it("validates command payload schema", async () => {
    const aggregateId = generateTestAggregateId("command-validate");

    // Try to send invalid command (missing required fields)
    await expect(
      pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        // missing value
      }),
    ).rejects.toThrow();
  });

  it("commands for same aggregate are processed sequentially with locks", async () => {
    const aggregateId = generateTestAggregateId("command-lock");

    // Send multiple commands for the same aggregate concurrently
    const command1Promise = pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 1,
    });

    const command2Promise = pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 2,
    });

    // Both commands should complete successfully
    await Promise.all([command1Promise, command2Promise]);

    // Wait for first checkpoint, then second (sequential processing)
    await waitForCheckpoint(
      pipeline.pipelineName,
      "testHandler",
      aggregateId,
      tenantIdString,
      1,
      15000,
      100,
      pipeline.processorCheckpointStore,
    );
    await waitForCheckpoint(
      pipeline.pipelineName,
      "testHandler",
      aggregateId,
      tenantIdString,
      2,
      15000,
      100,
      pipeline.processorCheckpointStore,
    );

    // Verify events were stored (commands create events)
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as any,
    );

    // Both commands should have created events
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
}, 60000);
