import { spawn, type ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

import { createLogger } from "@langwatch/observability";
import { NLP_INTERNAL_SECRET_ENV } from "@langwatch/process/nlp-internal-secret";
import {
  CHILD_PROCESS,
  encodeScenarioEgressPolicy,
  encodeScenarioLogContext,
  isVoiceNonceRegisterMessage,
  SCENARIO_EGRESS_POLICY_ENV,
  SCENARIO_LOG_CONTEXT_ENV,
  ScenarioAgentInstanceSchema,
  VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON_ENV,
  type ChildProcessJobData,
  type ScenarioEgressPolicy,
  type ScenarioExecutionResult,
  type ScenarioLogContext,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import {
  type ScenarioChildBootstrap,
  type ScenarioChildExecutionSession,
  type ScenarioChildEnvironment,
} from "../app/scenario.app.ts";
import { handleVoiceNonceRegisterMessage } from "../channels/voice-nonce-handoff.channels.ts";
import { resolveChildTlsEnv } from "../rules/child-tls-env.rules.ts";
import { ChildProcessSpawnService } from "./child-process-spawn.service.ts";
import type {
  ExecutionJobData,
  ScenarioExecutionPoolService,
} from "./scenario-execution-pool.service.ts";
import type { VoiceNonceRegistryService } from "./voice-nonce-registry.service.ts";
import type { VoicePublicUrl } from "./voice-public-url.service.ts";

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
  nodeEnv: string | undefined;
  isSaas: boolean;
  /** The worker's public media origin, or why it has none, forwarded only to voice children. */
  voicePublicUrl?: VoicePublicUrl;
  /** The deployment origin used by the phone transport's fallback refusal. */
  baseHost?: string;
  /**
   * The deployment's outbound fence, as the composing process resolved it. Required rather than
   * optional: a child with no stated policy refuses the run, and a field that could be left out
   * here is how that refusal would turn back into a silently permissive default.
   */
  egress: ScenarioEgressPolicy;
  /**
   * The engine hop's shared credential, as the process resolved it. The child's
   * environment is an allow-list, so a value this process holds and does not
   * state here is a child whose every workflow and code turn is refused 401.
   */
  nlpInternalSecret?: string | undefined;
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
  agentInstance?: { hostname: string; label: string | null };
  isCutAtLimit?: boolean;
};

export class NodeScenarioChildService implements ScenarioChildBootstrap {
  static readonly parseResult = parseChildProcessResultValue;
  static readonly buildEnvironment = buildChildEnvironmentValue;
  static readonly buildBaseEnvironment = buildBaseEnvironmentValue;
  static readonly buildOtelResourceAttributes = buildOtelResourceAttributesValue;

  static create(options: {
    config: ScenarioChildProcessConfig;
    pool: ScenarioExecutionPoolService;
    /** Where a voice child registers the media nonce the worker's door will be dialled with. */
    nonces: VoiceNonceRegistryService;
  }): NodeScenarioChildService {
    return new NodeScenarioChildService(options);
  }

  private constructor(
    private readonly options: {
      config: ScenarioChildProcessConfig;
      pool: ScenarioExecutionPoolService;
      nonces: VoiceNonceRegistryService;
    },
  ) {}

  // An arrow instance property, not a prototype method: tests hold a bare
  // Object.create(prototype) instance and monkey-patch this directly to
  // assert on it, which is unsafe against a method-shorthand member.
  start = (input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
  }): ScenarioChildExecutionSession => {
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
    const spawnConfig = ChildProcessSpawnService.create().resolve({
      packageRoot: this.options.config.packageRoot,
      nodeEnv: this.options.config.nodeEnv,
      sourcePath: this.options.config.sourcePath,
      sourceRoots: this.options.config.sourceRoots,
    });
    const spawnStartedAt = nowInstant().epochMilliseconds;
    log("info", "Spawning scenario child process", {
      command: spawnConfig.command,
      args: spawnConfig.args,
    });

    // A voice child mints its own Twilio stream nonce and registers it before it
    // dials; that round trip needs an IPC slot no other target's child has.
    const isVoiceChild = input.jobData.target.type === "voice";
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      env: childEnvironment,
      stdio: isVoiceChild ? ["pipe", "pipe", "pipe", "ipc"] : ["pipe", "pipe", "pipe"],
      cwd: this.options.config.packageRoot,
    });
    if (isVoiceChild) {
      child.on("message", (message: unknown) => {
        if (!isVoiceNonceRegisterMessage(message)) return;
        void handleVoiceNonceRegisterMessage({
          message,
          child,
          registry: this.options.nonces,
        }).then((ack) => child.send?.(ack));
      });
    }
    log("info", "Child process spawned", {
      pid: child.pid,
      spawnMs: nowInstant().epochMilliseconds - spawnStartedAt,
    });

    this.options.pool.registerChild(input.jobData.scenarioRunId, child);
    const completion = this.observeChild({ child, jobData: input.jobData, log });
    return NodeScenarioChildExecutionSession.create({ child, completion, log });
  };

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
        logChildChunk(chunk, "info", log);
      });
      child.stderr?.on("data", (data: Buffer) => {
        const chunk = data.toString();
        stderr += chunk;
        logChildChunk(chunk, "warn", log);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        this.options.pool.deregisterChild(input.jobData.scenarioRunId);
        if (settled) return;
        settled = true;

        resolve(
          childExitResult({
            code,
            stdout,
            stderr,
            log,
            cancelled: this.options.pool.wasCancelled(input.jobData.scenarioRunId),
          }),
        );
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

class NodeScenarioChildExecutionSession implements ScenarioChildExecutionSession {
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
  ) {}

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
  /** The connected agent instance that answered the run's turns, when one did. */
  agentInstance: ScenarioAgentInstanceSchema.optional(),
  /** LangWatch ended the voice call at the maximum call duration. */
  isCutAtLimit: z.boolean().optional(),
});

function buildChildEnvironmentValue(input: {
  config: ScenarioChildProcessConfig;
  jobData: ExecutionJobData;
  labels: string[];
  telemetry: ScenarioChildTelemetry;
}): NodeJS.ProcessEnv {
  return buildBaseEnvironmentValue({
    config: input.config,
    labels: input.labels,
    telemetry: input.telemetry,
    logContext: {
      scenarioRunId: input.jobData.scenarioRunId,
      batchRunId: input.jobData.batchRunId,
      projectId: input.jobData.projectId,
      scenarioId: input.jobData.scenarioId,
      setId: input.jobData.setId,
    },
    extra:
      input.jobData.target.type === "voice"
        ? {
            ...voicePublicUrlEnvironment(input.config.voicePublicUrl),
            BASE_HOST: input.config.baseHost,
          }
        : {},
  });
}

/** What every scenario child is started with, whichever job it runs. */
function buildBaseEnvironmentValue(input: {
  config: ScenarioChildProcessConfig;
  labels: string[];
  telemetry: ScenarioChildTelemetry;
  logContext: ScenarioLogContext;
  extra?: Record<string, string | undefined>;
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
    [SCENARIO_EGRESS_POLICY_ENV]: encodeScenarioEgressPolicy(input.config.egress),
    ...input.extra,
    [SCENARIO_LOG_CONTEXT_ENV]: encodeScenarioLogContext(input.logContext),
    ...tlsEnvironment,
  });
}

function buildOtelResourceAttributesValue(labels: string[]): string {
  const parts = ["langwatch.origin.source=platform"];
  if (labels.length > 0) {
    const escaped = labels.map((label) => label.replace(/\\/g, "\\\\").replace(/[,=]/g, "\\$&"));
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
    // The code and workflow adapters and the model factory all run INSIDE this
    // child and build their own engine requests, and this allow-list is the
    // only route into it. Without the forward, an install that configures the
    // credential answers from the parent fine and 401s on every simulation run
    // against a workflow or code agent.
    [NLP_INTERNAL_SECRET_ENV]: config.nlpInternalSecret,
    ...scenario,
  };
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) environment[key] = value;
  }
  return environment;
}

export const parseChildProcessResult = NodeScenarioChildService.parseResult;
export const buildChildEnvironment = NodeScenarioChildService.buildEnvironment;
export const buildOtelResourceAttributes = NodeScenarioChildService.buildOtelResourceAttributes;

type ChildLog = (
  level: "info" | "warn" | "error",
  message: string,
  extra?: Record<string, unknown>,
) => void;

function logChildChunk(chunk: string, level: "info" | "warn", log: ChildLog): void {
  for (const line of chunk.trim().split("\n")) {
    if (line) {
      log(level, line);
    }
  }
}

function childExitResult({
  code,
  stdout,
  stderr,
  log,
  cancelled,
}: {
  code: number | null;
  stdout: string;
  stderr: string;
  log: ChildLog;
  cancelled: boolean;
}): ScenarioExecutionResult {
  if (cancelled) {
    log("info", "Job cancelled via cancel broadcast");
    return { success: false, error: "Job was cancelled", cancelled: true };
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
    return { success: false, error };
  }

  log("info", "Scenario completed successfully", { exitCode: code });
  // The last JSON line the child wrote is the only place the connected
  // agent instance that answered the run is named; without reading it
  // here a finished run records no instance at all.
  const childResult = parseChildProcessResultValue(stdout);
  return {
    success: true,
    ...(childResult?.reasoning ? { reasoning: childResult.reasoning } : {}),
    ...(childResult?.agentInstance ? { agentInstance: childResult.agentInstance } : {}),
    ...(childResult?.isCutAtLimit ? { isCutAtLimit: true } : {}),
  };
}

/** The public origin a voice child dials back through, or the reason the phone run names. */
function voicePublicUrlEnvironment(publicUrl: VoicePublicUrl | undefined): NodeJS.ProcessEnv {
  if (publicUrl === undefined) return {};
  if ("url" in publicUrl) return { VOICE_PUBLIC_BASE_URL: publicUrl.url };
  return { [VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON_ENV]: publicUrl.unavailable };
}
