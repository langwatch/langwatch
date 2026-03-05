/**
 * @vitest-environment node
 *
 * Tests for scenario processor execution results.
 * Split from scenario.processor.otel.unit.test.ts for parallel execution.
 *
 * @see specs/scenarios/simulation-runner.feature lines 95-141
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createMockCollectorServer,
  createTestJobData,
  spawnChildProcessDirectly,
} from "./scenario-processor-test-helpers";

describe.skipIf(process.env.CI)("Scenario Processor - Execution Results", () => {
  let mockCollector: ReturnType<typeof createMockCollectorServer>;

  beforeAll(async () => {
    mockCollector = createMockCollectorServer();
    await mockCollector.start();
  }, 10000);

  afterAll(async () => {
    await mockCollector.stop();
  }, 10000);

  beforeEach(() => {
    mockCollector.requests.length = 0;
  });

  it(
    "returns result with success property",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { result } = await spawnChildProcessDirectly(jobData, env);

      expect(result).toHaveProperty("success");
      expect(typeof result.success).toBe("boolean");
    },
    60000
  );

  it(
    "returns success=false when execution fails",
    async () => {
      const jobData = createTestJobData({
        adapterData: {
          type: "http",
          agentId: "invalid-agent",
          url: "http://localhost:1/nonexistent",
          method: "POST",
          headers: [],
        },
      });

      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { result } = await spawnChildProcessDirectly(jobData, env);

      expect(result.success).toBe(false);
    },
    60000
  );

  it(
    "returns non-empty error message when execution fails",
    async () => {
      const jobData = createTestJobData({
        adapterData: {
          type: "http",
          agentId: "invalid-agent",
          url: "http://localhost:1/nonexistent",
          method: "POST",
          headers: [],
        },
      });

      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { result } = await spawnChildProcessDirectly(jobData, env);

      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
      expect(result.error!.length).toBeGreaterThan(0);
    },
    60000
  );

  it(
    "returns valid JSON via stdout",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { result } = await spawnChildProcessDirectly(jobData, env);

      expect(typeof result).toBe("object");
    },
    60000
  );
});
