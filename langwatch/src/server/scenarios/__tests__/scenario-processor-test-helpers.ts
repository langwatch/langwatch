/**
 * Shared test helpers for scenario processor OTEL tests.
 * These helpers are used across multiple test files to enable parallel execution.
 */

import { spawn, type ChildProcess } from "child_process";
import * as http from "http";
import * as path from "path";
import type {
  ChildProcessJobData,
  ScenarioExecutionResult,
} from "../execution/types";

/**
 * Time to wait for OTEL traces to flush after process completion.
 * Reduced from 3000ms - tests pass reliably with 1500ms.
 */
export const TRACE_FLUSH_WAIT_MS = 1500;

/**
 * Time to wait for OTEL traces to flush when running concurrent processes.
 */
export const CONCURRENT_TRACE_FLUSH_WAIT_MS = 1000;

/**
 * Mock HTTP server to capture OTEL trace requests.
 * Acts as the LangWatch collector endpoint.
 */
export interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export function createMockCollectorServer(): {
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
 * Build a minimal whitelisted env for child processes, matching production's
 * buildChildProcessEnv pattern. This prevents CI env vars (e.g., OTEL_*,
 * NODE_OPTIONS with conflicting flags) from leaking into child processes.
 */
export function buildTestChildProcessEnv(
  testEnv: Record<string, string>,
): NodeJS.ProcessEnv {
  const vars: Record<string, string | undefined> = {
    // System vars (required for tsx/node to run)
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    // Node.js vars
    NODE_ENV: process.env.NODE_ENV,
    // Skip t3-oss/env-nextjs validation — child process doesn't need server env vars
    SKIP_ENV_VALIDATION: "1",
    // CI/pnpm vars (required for pnpm exec tsx in CI)
    PNPM_HOME: process.env.PNPM_HOME,
    // npm config vars (required for node module resolution in CI)
    npm_config_local_prefix: process.env.npm_config_local_prefix,
    npm_config_global_prefix: process.env.npm_config_global_prefix,
    // Test-specific vars
    ...testEnv,
  };

  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv;
}

/**
 * Spawns the child process directly (not through the processor) for testing.
 * This allows us to pass controlled job data and capture results.
 */
export async function spawnChildProcessDirectly(
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
      env: buildTestChildProcessEnv(env),
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
export function createTestJobData(
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
    target: { type: "http", referenceId: "test-agent" },
    ...overrides,
  };
}
