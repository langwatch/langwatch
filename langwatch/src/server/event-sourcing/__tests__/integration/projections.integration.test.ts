import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AggregateType, EventUtils } from "../../library";
import {
  cleanupTestDataForTenant,
  createTestPipeline,
  createTestTenantId,
  getTenantIdString,
  waitForCheckpoint,
} from "./testHelpers";
import type { TestEvent, TestProjection } from "./testPipelines";

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
    // Close pipeline first to stop all workers and queues
    await pipeline.service.close();
    // Wait a bit for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Then clean up test data
    await cleanupTestDataForTenant(tenantIdString);
  });

  it("rebuilds projection correctly after events are stored", async () => {
    const aggregateId = "projection-test-8";

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

    // Wait for projection checkpoint at sequence 2
    await waitForCheckpoint(
      "test_pipeline",
      "testProjection",
      aggregateId,
      tenantIdString,
      2,
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
