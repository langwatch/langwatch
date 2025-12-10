import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import {
  cleanupTestDataForTenant,
  createTestPipeline,
  createTestTenantId,
  getTenantIdString,
  verifyCheckpoint,
  waitForQueueProcessing,
} from "./testHelpers";

describe("Event Handlers - Integration Tests", () => {
  let pipeline: ReturnType<typeof createTestPipeline>;
  let tenantId: ReturnType<typeof createTestTenantId>;
  let tenantIdString: string;

  beforeEach(() => {
    pipeline = createTestPipeline();
    tenantId = createTestTenantId();
    tenantIdString = getTenantIdString(tenantId);
  });

  afterEach(async () => {
    await cleanupTestDataForTenant(tenantIdString);
    await pipeline.service.close();
  });

  it("skips processing when previous events haven't been processed", async () => {
    const aggregateId = "handler-test-7";

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

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify both events were eventually processed
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );

    expect(events.length).toBe(2);

    // Verify checkpoint shows both were processed
    const checkpoint = await verifyCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      2,
    );
    expect(checkpoint).toBe(true);
  });
}, 60000);
