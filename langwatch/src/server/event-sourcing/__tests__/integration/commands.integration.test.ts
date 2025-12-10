import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cleanupTestDataForTenant,
  createTestPipeline,
  createTestTenantId,
  getTenantIdString,
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
    await cleanupTestDataForTenant(tenantIdString);
    await pipeline.service.close();
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
