import { createLogger } from "@langwatch/observability";
import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service";
import {
  CHILD_PROCESS,
  type ChildProcessJobData,
  type ScenarioExecutionResult,
} from "@langwatch/scenario-contract";
import {
  encodeScenarioLogContext,
  SCENARIO_LOG_CONTEXT_ENV,
} from "./child-logger.adapter";
import { resolveChildProcessSpawn } from "./child-process-spawn.adapter";
import { resolveChildTlsEnv } from "./child-tls-env.adapter";
import type { ScenarioExecutionPoolService } from "../services/scenario-execution-pool.service";
import {
  ScenarioChildBootstrapPort,
  ScenarioChildExecutionSession,
  type ScenarioChildEnvironment,
} from "../ports/scenario-child-bootstrap.port";

const logger = createLogger("langwatch:scenarios:child-process");

export interface ScenarioChildParentEnvironment {
  path?: string;
  home?: string;
  user?: string;
  shell?: string;
  lang?: string;
  lcAll?: string;
  term?: string;
  nodeCompileCache?: string;
  corepackEnableDownloadPrompt?: string;
  nodeExtraCaCerts?: string;
}

export interface ScenarioChildProcessConfig {
  packageRoot: string;
  sourcePath: string;
  sourceRoots: string[];
  nodeEnv: string;
  isSaas: boolean;
  parentEnvironment: ScenarioChildParentEnvironment;
}

export interface ScenarioChildTelemetry {
  endpoint: string;
  apiKey: string;
}

export type ScenarioChildProcessResult = {
  success: boolean;
  error?: string;
  reasoning?: string;
};

export class NodeScenarioChildProcessAdapter extends ScenarioChildBootstrapPort {
  static readonly parseResult = parseChildProcessResultValue;
  static readonly buildEnvironment = buildChildEnvironmentValue;
  static readonly buildOtelResourceAttributes = buildOtelResourceAttributesValue;

  static create(options: {
    config: ScenarioChildProcessConfig;
    pool: ScenarioExecutionPoolService;
  }): NodeScenarioChildProcessAdapter {
    return new NodeScenarioChildProcessAdapter(options);
  }

  private constructor(
    private readonly options: {
      config: ScenarioChildProcessConfig;
      pool: ScenarioExecutionPoolService;
    },
  ) {
    super();
  }

  start(input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
  }): ScenarioChildExecutionSession {
    const childLogger = logger.child({
      scenarioId: input.jobData.scenarioId,
      projectId: input.jobData.projectId,
      batchRunId: input.jobData.batchRunId,
      setId: input.jobData.setId,
      scenarioRunId: input.jobData.scenarioRunId,
      component: "child-process",
    });
    const log = (
      level: "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => childLogger[level](extra ?? {}, message);

    const childEnvironment = buildChildEnvironmentValue({
      config: this.options.config,
      jobData: input.jobData,
      labels: input.environment.labels,
      telemetry: input.environment.telemetry,
    });
    const spawnConfig = resolveChildProcessSpawn({
      packageRoot: this.options.config.packageRoot,
      nodeEnv: this.options.config.nodeEnv,
      sourcePath: this.options.config.sourcePath,
      sourceRoots: this.options.config.sourceRoots,
    });
    const spawnStartedAt = Date.now();
    log("info", "Spawning scenario child process", {
      command: spawnConfig.command,
      args: spawnConfig.args,
    });

    const child = spawn(spawnConfig.command, spawnConfig.args, {
      env: childEnvironment,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: this.options.config.packageRoot,
    });
    log("info", "Child process spawned", {
      pid: child.pid,
      spawnMs: Date.now() - spawnStartedAt,
    });

    this.options.pool.registerChild(input.jobData.scenarioRunId, child);
    const completion = this.observeChild({ child, jobData: input.jobData, log });
    return NodeScenarioChildExecutionSession.create({ child, completion, log });
  }

  private observeChild(input: {
    child: ChildProcess;
    jobData: ExecutionJobData;
    log: (
      level: "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => void;
  }): Promise<ScenarioExecutionResult> {
    return new Promise((resolve) => {
      const { child, log } = input;
      let stderr = "";
      let stdout = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        log("error", "Child process timed out", { timeoutMs: CHILD_PROCESS.TIMEOUT_MS });
        child.kill();
        resolve({ success: false, error: "Scenario execution timed out" });
      }, CHILD_PROCESS.TIMEOUT_MS);

      child.stdout?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        for (const line of chunk.trim().split("\n")) {
          if (line) log("info", line);
        }
      });
      child.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        for (const line of chunk.trim().split("\n")) {
          if (line) log("warn", line);
        }
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        this.options.pool.deregisterChild(input.jobData.scenarioRunId);
        if (settled) return;
        settled = true;

        if (this.options.pool.wasCancelled(input.jobData.scenarioRunId)) {
          log("info", "Job cancelled via cancel broadcast");
          resolve({ success: false, error: "Job was cancelled", cancelled: true });
          return;
        }
        if (code !== 0) {
          const childResult = parseChildProcessResultValue(stdout);
          const error = childResult?.error?.trim()
            ? childResult.error
            : `Child process exited with code ${code}: ${stderr}`;
          log("error", `Child process exited with code ${code}`, {
            exitCode: code,
            stderr,
          });
          resolve({ success: false, error });
          return;
        }

        log("info", "Scenario completed successfully", { exitCode: code });
        resolve({ success: true });
      });
      child.on("error", (error) => {
        clearTimeout(timeout);
        this.options.pool.deregisterChild(input.jobData.scenarioRunId);
        if (settled) return;
        settled = true;
        log("error", `Child process error: ${error.message}`);
        resolve({ success: false, error: `Child process error: ${error.message}` });
      });

      child.stdin?.on("error", (error) => {
        log("warn", "Child stdin error", { error: error.message });
      });
    });
  }
}

class NodeScenarioChildExecutionSession extends ScenarioChildExecutionSession {
  static create(options: {
    child: ChildProcess;
    completion: Promise<ScenarioExecutionResult>;
    log: (
      level: "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => void;
  }): NodeScenarioChildExecutionSession {
    return new NodeScenarioChildExecutionSession(options);
  }

  private started = false;

  private constructor(
    private readonly options: {
      child: ChildProcess;
      completion: Promise<ScenarioExecutionResult>;
      log: (
        level: "info" | "warn" | "error",
        message: string,
        extra?: Record<string, unknown>,
      ) => void;
    },
  ) {
    super();
  }

  execute(data: ChildProcessJobData): Promise<ScenarioExecutionResult> {
    if (this.started) {
      throw new Error("Scenario child execution has already started");
    }
    this.started = true;
    try {
      this.options.child.stdin?.write(JSON.stringify(data));
      this.options.child.stdin?.end();
    } catch (error) {
      this.options.log("warn", "Child stdin write failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return this.options.completion;
  }

  async abort(): Promise<void> {
    this.options.child.kill("SIGTERM");
    await this.options.completion;
  }
}

function parseChildProcessResultValue(stdout: string): ScenarioChildProcessResult | null {
  for (const line of stdout.split("\n").reverse()) {
    const result = parseResultLine(line);
    if (result) return result;
  }
  return null;
}

function parseResultLine(line: string): ScenarioChildProcessResult | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    return scenarioChildProcessResultSchema.safeParse(parsed).data ?? null;
  } catch {
    return null;
  }
}

import { z } from "zod";

const scenarioChildProcessResultSchema = z.object({
  success: z.boolean(),
  error: z.string().optional(),
  reasoning: z.string().optional(),
});

function buildChildEnvironmentValue(input: {
  config: ScenarioChildProcessConfig;
  jobData: ExecutionJobData;
  labels: string[];
  telemetry: ScenarioChildTelemetry;
}): NodeJS.ProcessEnv {
  const tlsEnvironment = resolveChildTlsEnv({
    isSaaS: input.config.isSaas,
    nodeEnv: input.config.nodeEnv,
    nodeExtraCaCerts: input.config.parentEnvironment.nodeExtraCaCerts,
  });
  return buildChildProcessEnvironment(input.config, {
    LANGWATCH_API_KEY: input.telemetry.apiKey,
    LANGWATCH_ENDPOINT: input.telemetry.endpoint,
    SCENARIO_HEADLESS: "true",
    OTEL_RESOURCE_ATTRIBUTES: buildOtelResourceAttributesValue(input.labels),
    [SCENARIO_LOG_CONTEXT_ENV]: encodeScenarioLogContext({
      scenarioRunId: input.jobData.scenarioRunId,
      batchRunId: input.jobData.batchRunId,
      projectId: input.jobData.projectId,
      scenarioId: input.jobData.scenarioId,
      setId: input.jobData.setId,
    }),
    ...tlsEnvironment,
  });
}

function buildOtelResourceAttributesValue(labels: string[]): string {
  const parts = ["langwatch.origin.source=platform"];
  if (labels.length > 0) {
    const escaped = labels.map((label) =>
      label.replace(/\\/g, "\\\\").replace(/[,=]/g, "\\$&"),
    );
    parts.push(`scenario.labels=${escaped.join(",")}`);
  }
  return parts.join(",");
}

function buildChildProcessEnvironment(
  config: ScenarioChildProcessConfig,
  scenario: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const parent = config.parentEnvironment;
  const compileCache = path.join(os.tmpdir(), "langwatch-scenario-compile-cache");
  const values: Record<string, string | undefined> = {
    PATH: parent.path,
    HOME: parent.home,
    USER: parent.user,
    SHELL: parent.shell,
    LANG: parent.lang,
    LC_ALL: parent.lcAll,
    TERM: parent.term,
    NODE_ENV: config.nodeEnv,
    SKIP_ENV_VALIDATION: "1",
    NODE_COMPILE_CACHE: parent.nodeCompileCache ?? compileCache,
    COREPACK_ENABLE_DOWNLOAD_PROMPT: parent.corepackEnableDownloadPrompt,
    ...scenario,
  };
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export const parseChildProcessResult = NodeScenarioChildProcessAdapter.parseResult;
export const buildChildEnvironment = NodeScenarioChildProcessAdapter.buildEnvironment;
export const buildOtelResourceAttributes =
  NodeScenarioChildProcessAdapter.buildOtelResourceAttributes;
