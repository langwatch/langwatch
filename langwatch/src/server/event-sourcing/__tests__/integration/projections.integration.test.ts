import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestPipeline } from "./testHelpers";
import {
  createTestTenantId,
  getTenantIdString,
  waitForQueueProcessing,
  cleanupTestDataForTenant,
  verifyCheckpoint,
} from "./testHelpers";
import type { TestEvent, TestProjection } from "./testPipelines";
import { type AggregateType, EventUtils } from "../../library";

describe("Projections - Integration Tests", () => {
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

  it("creates projection from events through BullMQ queue", async () => {
    const aggregateId = "projection-test-1";

    // Send command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 25,
      message: "first event",
    });

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify projection was created
    const projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;

    expect(projection).toBeDefined();
    expect(projection?.data.totalValue).toBe(25);
    expect(projection?.data.eventCount).toBe(1);
    expect(projection?.data.lastMessage).toBe("first event");
  });

  it("rebuilds projection from all events when new event arrives", async () => {
    const aggregateId = "projection-test-2";

    // Send first command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 10,
      message: "first",
    });

    await waitForQueueProcessing(10000);

    // Verify initial projection
    let projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;
    expect(projection?.data.totalValue).toBe(10);
    expect(projection?.data.eventCount).toBe(1);

    // Send second command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 20,
      message: "second",
    });

    await waitForQueueProcessing(10000);

    // Verify projection was rebuilt with all events
    projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;
    expect(projection?.data.totalValue).toBe(30); // 10 + 20
    expect(projection?.data.eventCount).toBe(2);
    expect(projection?.data.lastMessage).toBe("second");
  });

  it("maintains projection checkpoints", async () => {
    const aggregateId = "projection-test-3";

    // Send command
    await pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 15,
    });

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify checkpoint
    const checkpoint = await verifyCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      1,
    );
    expect(checkpoint).toBe(true);
  });

  it("processes projections for multiple aggregates concurrently", async () => {
    const aggregateIds = [
      "projection-test-4",
      "projection-test-5",
      "projection-test-6",
    ];

    // Send commands for multiple aggregates
    await Promise.all(
      aggregateIds.map((aggregateId, index) =>
        pipeline.commands.testCommand.send({
          tenantId: tenantIdString,
          aggregateId,
          value: (index + 1) * 10,
        }),
      ),
    );

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify all projections were created
    for (const aggregateId of aggregateIds) {
      const projection = (await pipeline.service.getProjectionByName(
        "testProjection",
        aggregateId,
        { tenantId },
      )) as TestProjection | null;
      expect(projection).toBeDefined();
      expect(projection?.data.eventCount).toBe(1);
    }
  });

  it("handles projection updates with concurrent events", async () => {
    const aggregateId = "projection-test-7";

    // Send multiple commands quickly
    const values = [1, 2, 3, 4, 5];
    for (const value of values) {
      await pipeline.commands.testCommand.send({
        tenantId: tenantIdString,
        aggregateId,
        value,
      });
    }

    // Wait for processing
    await waitForQueueProcessing(30000);

    // Verify final projection state
    const projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;

    expect(projection).toBeDefined();
    expect(projection?.data.totalValue).toBe(15); // 1+2+3+4+5
    expect(projection?.data.eventCount).toBe(5);

    // Verify checkpoint
    const checkpoint = await verifyCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      5,
    );
    expect(checkpoint).toBe(true);
  });

  it("rebuilds projection correctly after events are stored", async () => {
    const aggregateId = "projection-test-8";

    // Store events directly (bypassing command)
    const event1 = EventUtils.createEvent(
      "test_aggregate" as AggregateType,
      aggregateId,
      tenantId,
      "test.integration.event" as const,
      { value: 5 },
    );
    const event2 = EventUtils.createEvent(
      "test_aggregate" as AggregateType,
      aggregateId,
      tenantId,
      "test.integration.event" as const,
      { value: 10 },
    );
    const events = [event1, event2] as TestEvent[];

    await pipeline.service.storeEvents(events, {
      tenantId,
    });

    // Wait for projection processing
    await waitForQueueProcessing(30000);

    // Verify projection
    const projection = (await pipeline.service.getProjectionByName(
      "testProjection",
      aggregateId,
      { tenantId },
    )) as TestProjection | null;

    expect(projection).toBeDefined();
    expect(projection?.data.totalValue).toBe(15);
    expect(projection?.data.eventCount).toBe(2);
  });
}, 60000);
