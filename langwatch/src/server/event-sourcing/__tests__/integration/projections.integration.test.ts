import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AggregateType, EventUtils } from "../../library";
import {
  cleanupTestDataForTenant,
  closePipelineGracefully,
  createTestPipeline,
  createTestTenantId,
  generateTestAggregateId,
  getTenantIdString,
  waitForProjection,
} from "./testHelpers";
import type { TestEvent, TestProjection } from "./testPipelines";

describe("Projections - Integration Tests", () => {
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

  it("rebuilds projection correctly after events are stored", async () => {
    const aggregateId = generateTestAggregateId("projection");

    // Store events directly (bypassing command)
    const event1 = EventUtils.createEvent(
      "test_aggregate" as AggregateType,
      aggregateId,
      tenantId,
      "test.integration.event" as const,
      "2025-12-17",
      { value: 5 },
    );
    const event2 = EventUtils.createEvent(
      "test_aggregate" as AggregateType,
      aggregateId,
      tenantId,
      "test.integration.event" as const,
      "2025-12-17",
      { value: 10 },
    );
    const events = [event1, event2] as TestEvent[];

    await pipeline.service.storeEvents(events, {
      tenantId,
    });

    // Wait for fold projection to reach expected event count
    await waitForProjection(
      pipeline,
      "testProjection",
      aggregateId,
      tenantId,
      2,
      15000,
    );

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
}, 40000);
