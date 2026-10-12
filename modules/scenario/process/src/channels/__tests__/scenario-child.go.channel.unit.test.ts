/**
 * @vitest-environment node
 *
 * @see specs/scenarios/go-scenario-runner-choice.feature
 */
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SCENARIO_EGRESS_POLICY_ENV,
  SCENARIO_LOG_CONTEXT_ENV,
  type ChildProcessJobData,
} from "@langwatch/scenario-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ScenarioExecutionRunner } from "../../app/scenario.app.ts";
import {
  ScenarioExecutionPoolService,
  type ExecutionJobData,
} from "../../services/scenario-execution-pool.service.ts";
import { GoScenarioChildChannel } from "../scenario-child.go.channel.ts";
import type { ScenarioChildProcessConfig } from "../scenario-child.node.channel.ts";

/** Stands in for the Go binary: echoes the environment it was given and the job it read. */
const STAND_IN = `#!/usr/bin/env node
let input = "";
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const job = JSON.parse(input);
  process.stdout.write("a banner line\\n");
  const reasoning = JSON.stringify({ keys: Object.keys(process.env), scenarioId: job.scenario.id });
  process.stdout.write(JSON.stringify({ success: true, reasoning }) + "\\n");
});
`;

/** What the Node child's builder may set; anything else in the runner's environment leaked. */
const ALLOWED_KEYS = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "NODE_ENV",
  "SKIP_ENV_VALIDATION",
  "NODE_COMPILE_CACHE",
  "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  "LOG_LEVEL",
  "LOG_FORMAT",
  "LANGWATCH_API_KEY",
  "LANGWATCH_ENDPOINT",
  "SCENARIO_HEADLESS",
  "OTEL_RESOURCE_ATTRIBUTES",
  SCENARIO_EGRESS_POLICY_ENV,
  SCENARIO_LOG_CONTEXT_ENV,
  "NODE_TLS_REJECT_UNAUTHORIZED",
  "NODE_EXTRA_CA_CERTS",
  // macOS writes this into every process it starts; no parent passes it.
  "__CF_USER_TEXT_ENCODING",
]);

class HeldRunner implements ScenarioExecutionRunner {
  execute(): Promise<void> {
    return new Promise(() => {});
  }
  skipCancelled(): void {}
}

const jobData: ExecutionJobData = {
  projectId: "project-1",
  scenarioId: "scenario-1",
  scenarioRunId: "run-1",
  batchRunId: "batch-1",
  setId: "set-1",
  target: { type: "http", referenceId: "agent-1" },
};

const childJob: ChildProcessJobData = {
  context: {
    projectId: "project-1",
    scenarioId: "scenario-1",
    setId: "set-1",
    batchRunId: "batch-1",
  },
  scenario: { id: "scenario-1", name: "Test", situation: "Ask", criteria: [], labels: [] },
  adapterData: {
    type: "http",
    agentId: "agent-1",
    url: "https://x.test",
    method: "POST",
    headers: [],
    secrets: {},
  },
  nlpServiceUrl: "http://nlp.test",
  target: { type: "http", referenceId: "agent-1" },
  parameters: {},
};

describe("GoScenarioChildChannel", () => {
  let directory = "";
  let binaryPath = "";
  const probe = "LANGWATCH_WORKER_SECRET_PROBE";

  beforeAll(() => {
    directory = mkdtempSync(path.join(os.tmpdir(), "go-runner-stand-in-"));
    binaryPath = path.join(directory, "scenariorunner");
    writeFileSync(binaryPath, STAND_IN);
    chmodSync(binaryPath, 0o755);
    process.env[probe] = "worker-only-secret";
  });

  afterAll(() => {
    delete process.env[probe];
    rmSync(directory, { recursive: true, force: true });
  });

  function config(): ScenarioChildProcessConfig {
    return {
      packageRoot: directory,
      sourcePath: path.join(directory, "main.ts"),
      sourceRoots: [directory],
      nodeEnv: "production",
      isSaas: true,
      egress: { blockLocal: true, allowedHosts: [] },
      nlpInternalSecret: void 0,
      parentEnvironment: { path: process.env.PATH },
    };
  }

  async function run() {
    const pool = ScenarioExecutionPoolService.create({ concurrency: 1 });
    pool.connect(new HeldRunner());
    pool.submit(jobData);
    const runner = GoScenarioChildChannel.create({ config: config(), binaryPath });
    const session = await runner.start({
      jobData,
      pool,
      environment: { labels: ["a"], telemetry: { endpoint: "https://x.test", apiKey: "run-key" } },
    });
    const result = await session.execute(childJob);
    const echoed: { keys: string[]; scenarioId: string } = JSON.parse(result.reasoning ?? "{}");
    return { result, echoed };
  }

  describe("given the worker process holds a secret in its own environment", () => {
    /** @scenario "A worker secret in the parent's environment never reaches the Go runner" */
    it("starts the runner with only the Node child's allow-listed variables", async () => {
      const { echoed } = await run();

      expect(echoed.keys).not.toContain(probe);
      expect(echoed.keys.filter((key) => !ALLOWED_KEYS.has(key))).toEqual([]);
      expect(echoed.keys).toContain("LANGWATCH_API_KEY");
      expect(echoed.keys).toContain(SCENARIO_EGRESS_POLICY_ENV);
    });
  });

  describe("given the runner writes its result as its last stdout line", () => {
    /** @scenario "The Go runner's result line is read like the Node child's" */
    it("reads the result with the Node child's parser after the job reached stdin", async () => {
      const { result, echoed } = await run();

      expect(result.success).toBe(true);
      expect(echoed.scenarioId).toBe("scenario-1");
    });
  });
});
