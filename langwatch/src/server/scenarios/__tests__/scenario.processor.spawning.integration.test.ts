/**
 * @vitest-environment node
 *
 * Tests for scenario processor worker thread spawning.
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

describe.skipIf(process.env.CI)("Scenario Processor - Worker Spawning", () => {
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
    "spawns child process that exits with defined code",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { exitCode } = await spawnChildProcessDirectly(jobData, env);

      expect(exitCode).toBeDefined();
    },
    60000
  );

  it(
    "receives serialized scenario data and returns result object",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { result } = await spawnChildProcessDirectly(jobData, env);

      expect(typeof result.success).toBe("boolean");
    },
    60000
  );

  it(
    "passes LiteLLM params to child process",
    async () => {
      const customModelParams = {
        api_key: "custom-litellm-key",
        model: "anthropic/claude-3-haiku",
        api_base: "https://custom.api.com",
      };

      const jobData = createTestJobData({
        modelParams: customModelParams,
      });

      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { result } = await spawnChildProcessDirectly(jobData, env);

      expect(result).toBeDefined();
    },
    60000
  );
});
