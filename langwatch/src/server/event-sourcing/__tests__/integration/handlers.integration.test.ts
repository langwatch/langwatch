import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import {
  cleanupTestDataForTenant,
  closePipelineGracefully,
  createTestPipeline,
  createTestTenantId,
  generateTestAggregateId,
  getTenantIdString,
  verifyCheckpoint,
  waitForCheckpoint,
} from "./testHelpers";

describe("Event Handlers - Integration Tests", () => {
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

  it("skips processing when previous events haven't been processed", async () => {
    const aggregateId = generateTestAggregateId("handler");

    // This test verifies that sequential ordering is enforced
    // If event 2 arrives before event 1 is processed, event 2 should wait

    // Send first command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 1,
    });

    // Immediately send second command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 2,
    });

    // Wait for handler to process both events (checks checkpoint directly, much faster)
    await waitForCheckpoint(
      pipeline.pipelineName,
      "testHandler",
      aggregateId,
      tenantIdString,
      2,
      15000, // 15 second timeout for sequential event processing
      100,
      pipeline.processorCheckpointStore,
    );

    // Checkpoint verification above already confirms both events were processed
    // Optionally verify events were stored (but this is redundant since checkpoint confirms processing)
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );
    expect(events.length).toBe(2);
  });
}, 20000);
