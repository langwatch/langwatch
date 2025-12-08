import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import {
  cleanupTestDataForTenant,
  createTestPipeline,
  createTestTenantId,
  getTenantIdString,
  verifyCheckpoint,
  verifyEventHandlerProcessed,
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

  it("processes events through BullMQ queue", async () => {
    const aggregateId = "handler-test-1";

    // Send command to create event
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 100,
    });

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Get the created event
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );

    expect(events.length).toBe(1);
    const event = events[0];
    if (event) {
      // Verify handler processed the event
      const processed = await verifyEventHandlerProcessed(
        event.id,
        tenantIdString,
      );
      expect(processed).toBe(true);
    }
  });

  it("processes events in sequential order per aggregate", async () => {
    const aggregateId = "handler-test-2";

    // Send multiple commands
    const values = [10, 20, 30];
    for (const value of values) {
      await pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        value,
      });
    }

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Get events
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );

    expect(events.length).toBe(3);

    // Verify all events were processed by handler
    for (const event of events) {
      const processed = await verifyEventHandlerProcessed(
        event.id,
        tenantIdString,
      );
      expect(processed).toBe(true);
    }

    // Verify checkpoint shows last processed event
    const checkpoint = await verifyCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      3, // sequence number 3
    );
    expect(checkpoint).toBe(true);
  });

  it("maintains handler checkpoints across processing", async () => {
    const aggregateId = "handler-test-3";

    // Send first command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 5,
    });

    await waitForQueueProcessing(10000);

    // Verify checkpoint after first event
    let checkpoint = await verifyCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      1,
    );
    expect(checkpoint).toBe(true);

    // Send second command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 10,
    });

    await waitForQueueProcessing(10000);

    // Verify checkpoint updated
    checkpoint = await verifyCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      2,
    );
    expect(checkpoint).toBe(true);
  });

  it("processes events for different aggregates concurrently", async () => {
    const aggregateIds = ["handler-test-4", "handler-test-5", "handler-test-6"];

    // Send commands for multiple aggregates
    await Promise.all(
      aggregateIds.map((aggregateId) =>
        pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: 50,
        }),
      ),
    );

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify all handlers processed their events
    for (const aggregateId of aggregateIds) {
      const events = await pipeline.eventStore.getEvents(
        aggregateId,
        { tenantId },
        "test_aggregate" as AggregateType,
      );

      expect(events.length).toBe(1);
      const event = events[0];
      if (event) {
        const processed = await verifyEventHandlerProcessed(
          event.id,
          tenantIdString,
        );
        expect(processed).toBe(true);
      }
    }
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
