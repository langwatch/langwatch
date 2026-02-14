import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import {
  cleanupTestDataForTenant,
  closePipelineGracefully,
  createTestPipeline,
  createTestTenantId,
  generateTestAggregateId,
  getTenantIdString,
  verifyEventHandlerProcessed,
  waitForEventHandler,
  waitForProjection,
} from "./testHelpers";
import type { TestEvent, TestProjection } from "./testPipelines";

describe("Event Sourcing Pipeline - Full Integration Tests", () => {
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

  it("processes complete flow: command → event → handler → projection", async () => {
    const aggregateId = generateTestAggregateId();

    // Send command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 10,
      message: "test message",
    });

    // Wait for handler and projection to process
    await waitForEventHandler(aggregateId, tenantIdString, 1, 5000);
    await waitForProjection(pipeline, "testProjection", aggregateId, tenantId, 1, 5000);

    // Verify event was stored
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );
    expect(events.length).toBeGreaterThan(0);
    const event = events[0] as TestEvent | undefined;
    expect(event?.data.value).toBe(10);

    // Verify handler processed the event
    const eventId = events[0]?.id;
    if (eventId) {
      const handlerProcessed = await verifyEventHandlerProcessed(
        eventId,
        tenantIdString,
      );
      expect(handlerProcessed).toBe(true);
    }

    // Verify projection was created
    const projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;
    expect(projection).toBeDefined();
    expect(projection?.data.totalValue).toBe(10);
    expect(projection?.data.eventCount).toBe(1);
  });

  it("processes multiple events in sequential order per aggregate", async () => {
    const aggregateId = generateTestAggregateId();

    // Send multiple commands
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 5,
      message: "first",
    });

    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 10,
      message: "second",
    });

    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 15,
      message: "third",
    });

    // Wait for all events to be processed
    await waitForEventHandler(aggregateId, tenantIdString, 3, 20000);
    await waitForProjection(pipeline, "testProjection", aggregateId, tenantId, 3, 20000);

    // Verify events were stored in order
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );
    expect(events.length).toBe(3);

    // Verify sequential ordering
    for (let i = 1; i < events.length; i++) {
      const prev = events[i - 1];
      const curr = events[i];
      if (prev && curr) {
        expect(curr.timestamp).toBeGreaterThanOrEqual(prev.timestamp);
      }
    }

    // Verify projection aggregates all events
    const projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;
    expect(projection?.data.totalValue).toBe(30); // 5 + 10 + 15
    expect(projection?.data.eventCount).toBe(3);
    expect(projection?.data.lastMessage).toBe("third");
  });

  it("processes multiple aggregates concurrently", async () => {
    const aggregateIds = [
      generateTestAggregateId("concurrent-1"),
      generateTestAggregateId("concurrent-2"),
      generateTestAggregateId("concurrent-3"),
    ];

    // Send commands for multiple aggregates concurrently
    await Promise.all(
      aggregateIds.map((aggregateId, index) =>
        pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: (index + 1) * 10,
          message: `aggregate-${index + 1}`,
        }),
      ),
    );

    // Wait for all aggregates to be processed
    await Promise.all(
      aggregateIds.map((aggregateId) =>
        waitForEventHandler(aggregateId, tenantIdString, 1, 10000),
      ),
    );

    // Verify all aggregates were processed
    for (const aggregateId of aggregateIds) {
      const events = await pipeline.eventStore.getEvents(
        aggregateId,
        { tenantId },
        "test_aggregate" as AggregateType,
      );
      expect(events.length).toBe(1);

      const projection = (await pipeline.service.getProjectionByName(
        "testProjection",
        aggregateId,
        { tenantId },
      )) as TestProjection | null;
      expect(projection).toBeDefined();
    }
  });

  it("rebuilds projection from all events when new event arrives", async () => {
    const aggregateId = generateTestAggregateId();

    // Send first command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 5,
      message: "first",
    });

    await waitForProjection(pipeline, "testProjection", aggregateId, tenantId, 1, 5000);

    // Verify initial projection
    let projection = await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    );
    expect(projection?.data.totalValue).toBe(5);
    expect(projection?.data.eventCount).toBe(1);

    // Send second command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 10,
      message: "second",
    });

    await waitForProjection(pipeline, "testProjection", aggregateId, tenantId, 2, 5000);

    // Verify projection was rebuilt with all events
    projection = await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    );
    expect(projection?.data.totalValue).toBe(15); // 5 + 10
    expect(projection?.data.eventCount).toBe(2);
    expect(projection?.data.lastMessage).toBe("second");
  });

  it("processes all events even when BullMQ deduplication flattens queue jobs", async () => {
    // This test verifies the batch processing behavior:
    // When multiple events arrive rapidly for the same aggregate,
    // BullMQ may deduplicate them into a single job.
    // The batch processor should still process ALL events from the event store.
    const aggregateId = generateTestAggregateId("dedup");

    // Send multiple commands rapidly without waiting
    // These will likely be deduplicated by BullMQ
    const promises = [
      pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        value: 1,
        message: "first",
      }),
      pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        value: 2,
        message: "second",
      }),
      pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        value: 3,
        message: "third",
      }),
    ];

    // Wait for all commands to be sent
    await Promise.all(promises);

    // Wait for all events to be processed
    await waitForEventHandler(aggregateId, tenantIdString, 3, 30000);
    await waitForProjection(pipeline, "testProjection", aggregateId, tenantId, 3, 30000);

    // Verify all events were stored
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as AggregateType,
    );
    expect(events.length).toBe(3);

    // Verify projection has all events aggregated
    const projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;
    expect(projection?.data.totalValue).toBe(6); // 1 + 2 + 3
    expect(projection?.data.eventCount).toBe(3);
    expect(projection?.data.lastMessage).toBe("third");
  });
}, 60000); // 60 second timeout for integration tests
