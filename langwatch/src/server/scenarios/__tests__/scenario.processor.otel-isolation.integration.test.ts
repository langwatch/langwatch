/**
 * @vitest-environment node
 *
 * Tests for scenario processor OTEL context isolation.
 * Split from scenario.processor.otel.unit.test.ts for parallel execution.
 *
 * @see specs/scenarios/simulation-runner.feature lines 95-141
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  CONCURRENT_TRACE_FLUSH_WAIT_MS,
  TRACE_FLUSH_WAIT_MS,
  createMockCollectorServer,
  createTestJobData,
  spawnChildProcessDirectly,
} from "./scenario-processor-test-helpers";

describe.skipIf(process.env.CI)("Scenario Processor - OTEL Isolation", () => {
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
    "sends traces to the configured LANGWATCH_ENDPOINT",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "isolated-test-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { stderr, exitCode } = await spawnChildProcessDirectly(jobData, env);

      await new Promise((resolve) => setTimeout(resolve, TRACE_FLUSH_WAIT_MS));

      expect(mockCollector.requests.length, `Expected traces but got 0 requests. Child exit code: ${exitCode}, stderr: ${stderr.slice(0, 500)}`).toBeGreaterThan(0);
    },
    60000
  );

  it(
    "sends traces to the OTEL traces endpoint",
    async () => {
      const jobData = createTestJobData();
      const env = {
        LANGWATCH_API_KEY: "isolated-test-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const { stderr, exitCode } = await spawnChildProcessDirectly(jobData, env);

      await new Promise((resolve) => setTimeout(resolve, TRACE_FLUSH_WAIT_MS));

      const hasTracesRequest = mockCollector.requests.some(
        (r) => r.url?.includes("traces") || r.url?.includes("otel")
      );
      expect(hasTracesRequest, `Expected traces endpoint request. Requests: ${mockCollector.requests.length}, urls: ${mockCollector.requests.map(r => r.url).join(", ")}, child exit: ${exitCode}, stderr: ${stderr.slice(0, 500)}`).toBe(true);
    },
    60000
  );

  it(
    "concurrent child processes have isolated traces with distinct scenario IDs",
    async () => {
      const jobData1 = createTestJobData({
        context: {
          projectId: "test-project",
          scenarioId: "scenario-isolation-AAA",
          setId: "test-set",
          batchRunId: "batch-run-AAA",
        },
        scenario: {
          id: "scenario-isolation-AAA",
          name: "Isolation Test Scenario A",
          situation: "First concurrent test",
          criteria: ["Must respond"],
          labels: ["test-a"],
        },
      });

      const jobData2 = createTestJobData({
        context: {
          projectId: "test-project",
          scenarioId: "scenario-isolation-BBB",
          setId: "test-set",
          batchRunId: "batch-run-BBB",
        },
        scenario: {
          id: "scenario-isolation-BBB",
          name: "Isolation Test Scenario B",
          situation: "Second concurrent test",
          criteria: ["Must respond"],
          labels: ["test-b"],
        },
      });

      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      const [result1, result2] = await Promise.all([
        spawnChildProcessDirectly(jobData1, env),
        spawnChildProcessDirectly(jobData2, env),
      ]);

      await new Promise((resolve) =>
        setTimeout(resolve, CONCURRENT_TRACE_FLUSH_WAIT_MS)
      );

      expect(result1.result).toBeDefined();
      expect(result2.result).toBeDefined();

      expect(mockCollector.requests.length).toBeGreaterThan(1);

      const allBodies = mockCollector.requests.map((r) => r.body).join("");

      const hasScenarioA =
        allBodies.includes("scenario-isolation-AAA") ||
        allBodies.includes("batch-run-AAA");
      const hasScenarioB =
        allBodies.includes("scenario-isolation-BBB") ||
        allBodies.includes("batch-run-BBB");

      expect(hasScenarioA).toBe(true);
      expect(hasScenarioB).toBe(true);

      const hasMixedTraces = mockCollector.requests.some(
        (r) =>
          (r.body.includes("scenario-isolation-AAA") ||
            r.body.includes("batch-run-AAA")) &&
          (r.body.includes("scenario-isolation-BBB") ||
            r.body.includes("batch-run-BBB"))
      );
      expect(hasMixedTraces).toBe(false);
    },
    90000
  );

  it(
    "passes OTEL_RESOURCE_ATTRIBUTES for labels",
    async () => {
      const jobData = createTestJobData({
        scenario: {
          id: "scenario-abc123",
          name: "Labeled Scenario",
          situation: "Test situation",
          criteria: ["Test criterion"],
          labels: ["support", "billing"],
        },
      });

      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
        OTEL_RESOURCE_ATTRIBUTES: "scenario.labels=support,billing",
      };

      const { result } = await spawnChildProcessDirectly(jobData, env);

      expect(result).toBeDefined();
    },
    60000
  );

  it(
    "includes setId in scenario events sent to collector",
    async () => {
      const testSetId = "custom-scenario-set-xyz";
      const jobData = createTestJobData({
        context: {
          projectId: "test-project",
          scenarioId: "test-scenario-setid",
          setId: testSetId,
          batchRunId: "test-batch-setid",
        },
      });

      const env = {
        LANGWATCH_API_KEY: "test-api-key",
        LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
      };

      await spawnChildProcessDirectly(jobData, env);

      await new Promise((resolve) => setTimeout(resolve, TRACE_FLUSH_WAIT_MS));

      const allBodies = mockCollector.requests.map((r) => r.body).join("");

      const hasSetId =
        allBodies.includes(testSetId) ||
        allBodies.includes("scenarioSetId") ||
        allBodies.includes("scenario_set_id");

      expect(hasSetId).toBe(true);
    },
    60000
  );
});
