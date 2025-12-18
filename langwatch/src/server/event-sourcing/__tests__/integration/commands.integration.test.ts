import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDataForTenant,
  createTestPipeline,
  createTestTenantId,
  getTenantIdString,
  waitForCheckpoint,
} from "./testHelpers";

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
    // Close pipeline to stop all workers and queues
    await pipeline.service.close();
    // Wait a bit for all async operations to complete
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Then clean up test data
    await cleanupTestDataForTenant(tenantIdString);
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

  it("commands for same aggregate are processed sequentially with locks", async () => {
    const aggregateId = "command-lock-test-1";

    // Send multiple commands for the same aggregate concurrently
    const command1Promise = pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 1,
    });

    const command2Promise = pipeline.commands.testCommand.send({
      tenantId: tenantIdString,
      aggregateId,
      value: 2,
    });

    // Both commands should complete successfully
    await Promise.all([command1Promise, command2Promise]);

    // Wait for first checkpoint, then second (sequential processing)
    await waitForCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      1,
      10000,
    );
    await waitForCheckpoint(
      "test_pipeline",
      "testHandler",
      aggregateId,
      tenantIdString,
      2,
      10000,
    );

    // Verify events were stored (commands create events)
    const events = await pipeline.eventStore.getEvents(
      aggregateId,
      { tenantId },
      "test_aggregate" as any,
    );

    // Both commands should have created events
    expect(events.length).toBeGreaterThanOrEqual(2);
  });
}, 60000);
