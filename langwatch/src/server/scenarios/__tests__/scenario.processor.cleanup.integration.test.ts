/**
 * @vitest-environment node
 *
 * Tests for scenario processor OTEL cleanup.
 * Split from scenario.processor.otel.unit.test.ts for parallel execution.
 *
 * @see specs/scenarios/simulation-runner.feature lines 95-141
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  TRACE_FLUSH_WAIT_MS,
  createMockCollectorServer,
  createTestJobData,
  spawnChildProcessDirectly,
} from "./scenario-processor-test-helpers";

describe.skipIf(process.env.CI)("Scenario Processor - OTEL Cleanup", () => {
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
    "child process exits with code 0 or 1",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { exitCode } = await spawnChildProcessDirectly(jobData, env);

      expect([0, 1]).toContain(exitCode);
    },
    60000
  );

  it(
    "flushes traces before process termination",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { stderr, exitCode } = await spawnChildProcessDirectly(jobData, env);

      await new Promise((resolve) => setTimeout(resolve, TRACE_FLUSH_WAIT_MS));

      expect(mockCollector.requests.length, `Expected flushed traces but got 0. Child exit: ${exitCode}, stderr: ${stderr.slice(0, 500)}`).toBeGreaterThan(0);
    },
    60000
  );
});
