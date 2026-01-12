import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AggregateType } from "../../library";
import {
  cleanupTestDataForTenant,
  createTestPipeline,
  createTestTenantId,
  getTenantIdString,
  verifyCheckpoint,
  verifyEventHandlerProcessed,
  waitForCheckpoint,
} from "./testHelpers";
import type { TestEvent, TestProjection } from "./testPipelines";

describe("Event Sourcing Pipeline - Full Integration Tests", () => {
  let pipeline: ReturnType<typeof createTestPipeline>;
  let tenantId: ReturnType<typeof createTestTenantId>;
  let tenantIdString: string;

  beforeEach(() => {
    pipeline = createTestPipeline();
    tenantId = createTestTenantId();
    tenantIdString = getTenantIdString(tenantId);
  });

  afterEach(async () => {
    // Close pipeline first to stop all workers and queues
    await pipeline.service.close();
    // Wait a bit for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Then clean up test data
    await cleanupTestDataForTenant(tenantIdString);
  });

  it("processes complete flow: command → event → handler → projection", async () => {
    const aggregateId = "test-aggregate-1";

    // Send command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 10,
      message: "test message",
    });

    // Wait for handler and projection checkpoints
    await waitForCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      1,
      5000,
      100,
      pipeline.processorCheckpointStore,
    );
    await waitForCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      1,
      5000,
      100,
      pipeline.processorCheckpointStore,
    );

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
    const aggregateId = "test-aggregate-2";

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

    // Wait for handler checkpoint at sequence 3
    await waitForCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      3,
      20000, // 20 second timeout for 3 sequential events
      100,
      pipeline.processorCheckpointStore,
    );

    // Wait for projection checkpoint at sequence 3 to ensure all events are processed
    await waitForCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      3,
      20000, // 20 second timeout for 3 sequential events
      100,
      pipeline.processorCheckpointStore,
    );

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

  it("maintains checkpoints across queue processing", async () => {
    const aggregateId = "test-aggregate-3";

    // Send command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 20,
    });

    // Wait for checkpoints with longer timeout for ClickHouse consistency
    await waitForCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      1,
      10000,
      100,
      pipeline.processorCheckpointStore,
    );
    await waitForCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      1,
      10000,
      100,
      pipeline.processorCheckpointStore,
    );

    // Verify handler checkpoint
    const handlerCheckpoint = await verifyCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      1,
    );
    expect(handlerCheckpoint).toBe(true);

    // Verify projection checkpoint
    const projectionCheckpoint = await verifyCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      1,
    );
    expect(projectionCheckpoint).toBe(true);
  });

  it("processes multiple aggregates concurrently", async () => {
    const aggregateIds = [
      "test-aggregate-4",
      "test-aggregate-5",
      "test-aggregate-6",
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

    // Wait for checkpoints for all aggregates
    await Promise.all(
      aggregateIds.map((aggregateId) =>
        waitForCheckpoint(
          "test_pipeline",
          "testHandler",
          aggregateId,
          tenantIdString,
          1,
        ),
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
    const aggregateId = "test-aggregate-7";

    // Send first command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 5,
      message: "first",
    });

    await waitForCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      1,
      5000,
      100,
      pipeline.processorCheckpointStore,
    );

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

    await waitForCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      2,
      5000,
      100,
      pipeline.processorCheckpointStore,
    );

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
    const aggregateId = "test-aggregate-dedup";

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

    // Wait for all 3 events to be processed
    // The batch processor should process all events even if only one queue job triggers
    await waitForCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      3,
      30000, // Longer timeout for dedup scenario
      100,
      pipeline.processorCheckpointStore,
    );

    await waitForCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      3,
      30000,
      100,
      pipeline.processorCheckpointStore,
    );

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
