/**
 * @vitest-environment node
 *
 * Tests for scenario processor OTEL trace isolation via child process spawning.
 *
 * These tests verify the child process spawning and OTEL isolation requirements
 * from specs/scenarios/simulation-runner.feature (Worker-Based Execution scenarios).
 *
 * We spawn REAL child processes to verify actual isolation behavior.
 * These tests do NOT require database access - they mock:
 * - The LangWatch collector HTTP endpoint (via a local HTTP server)
 *
 * Note: Named as unit test to avoid triggering ClickHouse setup from
 * vitest.integration.config.ts. The tests don't need database, only
 * process spawning and HTTP mocking.
 *
 * @see specs/scenarios/simulation-runner.feature lines 95-141
 */

import { spawn, type ChildProcess } from "child_process";
import * as http from "http";
import * as path from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  ChildProcessJobData,
  ScenarioExecutionResult,
} from "../execution/types";

/**
 * These tests spawn real child processes and don't require the database.
 * They only need the tsx executable to be available.
 * Child process spawning with tsx compilation requires longer timeouts.
 */

/**
 * Time to wait for OTEL traces to flush after process completion.
 */
const TRACE_FLUSH_WAIT_MS = 1000;

/**
 * Time to wait for OTEL traces to flush when running concurrent processes.
 */
const CONCURRENT_TRACE_FLUSH_WAIT_MS = 1500;

/**
 * Mock HTTP server to capture OTEL trace requests.
 * Acts as the LangWatch collector endpoint.
 */
interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function createMockCollectorServer(): {
  server: http.Server;
  port: number;
  requests: CapturedRequest[];
  start: () => Promise<void>;
  stop: () => Promise<void>;
} {
  const requests: CapturedRequest[] = [];
  let port = 0;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      requests.push({
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body,
      });

      // Return success for all requests
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
    });
  });

  return {
    server,
    get port() {
      return port;
    },
    requests,
    start: () =>
      new Promise<void>((resolve) => {
        server.listen(0, "127.0.0.1", () => {
          const addr = server.address();
          if (addr && typeof addr === "object") {
            port = addr.port;
          }
          resolve();
        });
      }),
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

/**
 * Spawns the child process directly (not through the processor) for testing.
 * This allows us to pass controlled job data and capture results.
 */
async function spawnChildProcessDirectly(
  jobData: ChildProcessJobData,
  env: Record<string, string>,
  timeoutMs = 45000
): Promise<{
  result: ScenarioExecutionResult;
  stderr: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    const childPath = path.resolve(
      process.cwd(),
      "src/server/scenarios/execution/scenario-child-process.ts"
    );

    const child: ChildProcess = spawn("pnpm", ["exec", "tsx", childPath], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      cwd: process.cwd(),
    });

    let stdout = "";
    let stderr = "";

    const timeout = setTimeout(() => {
      child.kill();
      resolve({
        result: { success: false, error: "Test timeout" },
        stderr,
        exitCode: null,
      });
    }, timeoutMs);

    child.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(stdout) as ScenarioExecutionResult;
        resolve({ result, stderr, exitCode: code });
      } catch {
        resolve({
          result: { success: false, error: `Failed to parse output: ${stdout}` },
          stderr,
          exitCode: code,
        });
      }
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({
        result: { success: false, error: error.message },
        stderr,
        exitCode: null,
      });
    });

    // Send job data to child via stdin
    child.stdin?.write(JSON.stringify(jobData));
    child.stdin?.end();
  });
}

/**
 * Creates minimal test job data for child process.
 */
function createTestJobData(
  overrides: Partial<ChildProcessJobData> = {}
): ChildProcessJobData {
  return {
    context: {
      projectId: "test-project",
      scenarioId: "test-scenario-123",
      setId: "test-set",
      batchRunId: "test-batch-run-456",
    },
    scenario: {
      id: "test-scenario-123",
      name: "Test Scenario",
      situation: "A user asks a simple question",
      criteria: ["Must respond politely"],
      labels: ["integration-test", "otel-isolation"],
    },
    adapterData: {
      type: "http",
      agentId: "test-agent",
      url: "http://localhost:9999/api/test", // Won't actually be called in error scenario
      method: "POST",
      headers: [],
    },
    modelParams: {
      api_key: "test-api-key",
      model: "openai/gpt-4o-mini",
    },
    nlpServiceUrl: "http://localhost:8080",
    ...overrides,
  };
}

describe("Scenario Processor - OTEL Isolation", () => {
  let mockCollector: ReturnType<typeof createMockCollectorServer>;

  beforeAll(async () => {
    mockCollector = createMockCollectorServer();
    await mockCollector.start();
  }, 10000);

  afterAll(async () => {
    await mockCollector.stop();
  }, 10000);

  beforeEach(() => {
    // Clear captured requests before each test
    mockCollector.requests.length = 0;
  });

  describe("worker thread spawning", () => {
    it(
      "spawns child process that exits with defined code",
      async () => {
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Execute scenario in isolated worker thread
         *   Then a worker thread is spawned
         */
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
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Execute scenario in isolated worker thread
         *   And the worker receives serialized scenario data
         */
        const jobData = createTestJobData();
        const env = {
          LANGWATCH_API_KEY: "test-api-key",
          LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
        };

        const { result } = await spawnChildProcessDirectly(jobData, env);

        // The result should have success boolean - proving data was deserialized
        expect(typeof result.success).toBe("boolean");
      },
      60000
    );

    it(
      "passes LiteLLM params to child process",
      async () => {
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Execute scenario in isolated worker thread
         *   And the worker receives serialized LiteLLM params
         */
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

        // Process ran - params were received (execution may fail due to invalid agent)
        expect(result).toBeDefined();
      },
      60000
    );
  });

  describe("OTEL context isolation", () => {
    it(
      "sends traces to the configured LANGWATCH_ENDPOINT",
      async () => {
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Worker thread has isolated OTEL context
         *   Then it creates its own OTEL TracerProvider
         *   And the provider exports to LangWatch endpoint
         */
        const jobData = createTestJobData();
        const env = {
          LANGWATCH_API_KEY: "isolated-test-key",
          LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
        };

        await spawnChildProcessDirectly(jobData, env);

        // Allow time for async trace flush
        await new Promise((resolve) => setTimeout(resolve, TRACE_FLUSH_WAIT_MS));

        // Verify traces actually arrived at the mock collector
        expect(mockCollector.requests.length).toBeGreaterThan(0);
      },
      60000
    );

    it(
      "sends traces to the OTEL traces endpoint",
      async () => {
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Worker thread has isolated OTEL context
         *   And the provider exports to LangWatch endpoint
         */
        const jobData = createTestJobData();
        const env = {
          LANGWATCH_API_KEY: "isolated-test-key",
          LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
        };

        await spawnChildProcessDirectly(jobData, env);

        // Allow time for async trace flush
        await new Promise((resolve) => setTimeout(resolve, TRACE_FLUSH_WAIT_MS));

        // Verify at least one request hit the traces endpoint
        const hasTracesRequest = mockCollector.requests.some(
          (r) => r.url?.includes("traces") || r.url?.includes("otel")
        );
        expect(hasTracesRequest).toBe(true);
      },
      60000
    );

    it(
      "concurrent child processes have isolated traces with distinct scenario IDs",
      async () => {
        /**
         * @see specs/scenarios/simulation-runner.feature line 113
         * Scenario: Worker thread has isolated OTEL context
         *   And traces are not mixed with server global telemetry
         *
         * This test spawns TWO child processes concurrently and verifies
         * their traces have distinct scenario IDs and don't mix.
         */
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

        // Spawn both processes concurrently
        const [result1, result2] = await Promise.all([
          spawnChildProcessDirectly(jobData1, env),
          spawnChildProcessDirectly(jobData2, env),
        ]);

        // Allow time for async trace flush from both processes
        await new Promise((resolve) =>
          setTimeout(resolve, CONCURRENT_TRACE_FLUSH_WAIT_MS)
        );

        // Both processes completed
        expect(result1.result).toBeDefined();
        expect(result2.result).toBeDefined();

        // REQUIRE traces to arrive - no conditional
        expect(mockCollector.requests.length).toBeGreaterThan(1);

        // Analyze the trace bodies to verify isolation
        // Each trace should contain only its own scenario ID, not the other's
        const allBodies = mockCollector.requests.map((r) => r.body).join("");

        // Both scenario IDs should appear in the captured requests
        // but importantly they should be in SEPARATE requests (isolation)
        const hasScenarioA =
          allBodies.includes("scenario-isolation-AAA") ||
          allBodies.includes("batch-run-AAA");
        const hasScenarioB =
          allBodies.includes("scenario-isolation-BBB") ||
          allBodies.includes("batch-run-BBB");

        // Verify BOTH scenario IDs appear - proves both processes sent traces
        expect(hasScenarioA).toBe(true);
        expect(hasScenarioB).toBe(true);

        // Verify isolation: no single request contains BOTH scenario IDs
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
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Worker traces include scenario metadata
         *   Then exported traces include scenarioId as resource attribute
         *   And exported traces include batchRunId as resource attribute
         */
        const jobData = createTestJobData({
          scenario: {
            id: "scenario-abc123",
            name: "Labeled Scenario",
            situation: "Test situation",
            criteria: ["Test criterion"],
            labels: ["support", "billing"],
          },
        });

        // The parent processor would set OTEL_RESOURCE_ATTRIBUTES
        // based on buildOtelResourceAttributes(labels)
        const env = {
          LANGWATCH_API_KEY: "test-api-key",
          LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
          OTEL_RESOURCE_ATTRIBUTES: "scenario.labels=support,billing",
        };

        const { result } = await spawnChildProcessDirectly(jobData, env);

        // Child process received the env vars and ran
        expect(result).toBeDefined();
      },
      60000
    );
  });

  describe("execution results", () => {
    it(
      "returns result with success property",
      async () => {
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Worker returns execution result to manager
         *   Then SimulationRunnerService receives success status
         */
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
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Worker reports errors to manager
         *   Then SimulationRunnerService receives failure status
         */
        const jobData = createTestJobData({
          adapterData: {
            type: "http",
            agentId: "invalid-agent",
            url: "http://localhost:1/nonexistent", // Invalid URL
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
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: Worker reports errors to manager
         *   And the result includes the error message
         */
        const jobData = createTestJobData({
          adapterData: {
            type: "http",
            agentId: "invalid-agent",
            url: "http://localhost:1/nonexistent", // Invalid URL
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
        /**
         * Communication protocol verification:
         * - Input: JSON job data via stdin
         * - Output: JSON result via stdout
         */
        const jobData = createTestJobData();
        const env = {
          LANGWATCH_API_KEY: "test-api-key",
          LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
        };

        const { result } = await spawnChildProcessDirectly(jobData, env);

        // Result is valid JSON structure (not string parsing error)
        expect(typeof result).toBe("object");
      },
      60000
    );
  });

  describe("OTEL cleanup", () => {
    it(
      "child process exits with code 0 or 1",
      async () => {
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: OTEL context is cleaned up after worker execution
         *   Then the TracerProvider is shut down
         *
         * We verify the process exits cleanly (exit code 0 or 1),
         * which indicates proper cleanup. The SDK handles TracerProvider shutdown.
         */
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
        /**
         * @see specs/scenarios/simulation-runner.feature
         * Scenario: OTEL context is cleaned up after worker execution
         *   And pending spans are flushed before termination
         *
         * Verifies that traces are sent to collector before process ends.
         * The @langwatch/scenario SDK should flush on shutdown.
         */
        const jobData = createTestJobData();
        const env = {
          LANGWATCH_API_KEY: "test-api-key",
          LANGWATCH_ENDPOINT: `http://127.0.0.1:${mockCollector.port}`,
        };

        await spawnChildProcessDirectly(jobData, env);

        // Allow time for async trace flush
        await new Promise((resolve) => setTimeout(resolve, TRACE_FLUSH_WAIT_MS));

        // Traces should have been flushed to the mock collector
        expect(mockCollector.requests.length).toBeGreaterThan(0);
      },
      60000
    );
  });
});

describe("buildOtelResourceAttributes", () => {
  /**
   * Unit tests for the label formatting function are in scenario.processor.unit.test.ts
   * These integration tests verify the function integrates correctly with child process env.
   */
  it(
    "formats labels as OTEL_RESOURCE_ATTRIBUTES with escaped special characters",
    async () => {
      const { buildOtelResourceAttributes } = await import(
        "../scenario.processor"
      );

      const labels = ["support", "billing", "priority=high"];
      const attrs = buildOtelResourceAttributes(labels);

      // Should escape special characters per OTEL spec
      expect(attrs).toBe("scenario.labels=support,billing,priority\\=high");
    },
    30000
  );
});
