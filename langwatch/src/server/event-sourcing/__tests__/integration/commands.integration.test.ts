import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import {
  cleanupTestDataForTenant,
  createTestPipeline,
  createTestTenantId,
  getTenantIdString,
  waitForQueueProcessing,
} from "./testHelpers";
import type { TestEvent } from "./testPipelines";

describe("Command Processing - Integration Tests", () => {
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

  it("sends command through BullMQ and processes it", async () => {
    const aggregateId = "command-test-1";

    // Send command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 42,
      message: "test command",
    });

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify event was created from command
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );

    expect(events.length).toBe(1);
    const event = events[0] as TestEvent | undefined;
    expect(event?.type).toBe("test.integration.event");
    expect(event?.data.value).toBe(42);
    expect(event?.data.message).toBe("test command");
    expect(event?.aggregateId).toBe(aggregateId);
  });

  it("processes multiple commands sequentially for same aggregate", async () => {
    const aggregateId = "command-test-2";

    // Send multiple commands
    const commands = [
      { value: 1, message: "first" },
      { value: 2, message: "second" },
      { value: 3, message: "third" },
    ];

    for (const cmd of commands) {
      await pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        ...cmd,
      });
    }

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify all events were created
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );

    expect(events.length).toBe(3);
    const event0 = events[0] as TestEvent | undefined;
    const event1 = events[1] as TestEvent | undefined;
    const event2 = events[2] as TestEvent | undefined;
    expect(event0?.data.value).toBe(1);
    expect(event1?.data.value).toBe(2);
    expect(event2?.data.value).toBe(3);
  });

  it("processes commands for different aggregates concurrently", async () => {
    const aggregateIds = ["command-test-3", "command-test-4", "command-test-5"];

    // Send commands concurrently
    await Promise.all(
      aggregateIds.map((aggregateId, index) =>
        pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: index + 1,
        }),
      ),
    );

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify all aggregates have events
    for (const aggregateId of aggregateIds) {
      const events = await pipeline.eventStore.getEvents(
        aggregateId,
        { tenantId },
        "test_aggregate" as AggregateType,
      );
      expect(events.length).toBe(1);
    }
  });

  it("validates command payload schema", async () => {
    const aggregateId = "command-test-6";

    // Try to send invalid command (missing required fields)
    await expect(
      // @ts-ignore - intentionally invalid payload for testing validation
      pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        // missing value
      }),
    ).rejects.toThrow();
  });
}, 60000);
