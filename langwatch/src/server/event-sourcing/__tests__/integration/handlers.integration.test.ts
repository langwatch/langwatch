import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import {
  cleanupTestDataForTenant,
  closePipelineGracefully,
  createTestPipeline,
  createTestTenantId,
  generateTestAggregateId,
  getTenantIdString,
  waitForEventHandler,
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

  it("processes multiple events for the same aggregate", async () => {
    const aggregateId = generateTestAggregateId("handler");

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

    // Wait for handler to process both events
    await waitForEventHandler(
      aggregateId,
      tenantIdString,
      2,
      15000,
    );

    // Verify events were stored
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );
    expect(events.length).toBe(2);
  });
}, 20000);
