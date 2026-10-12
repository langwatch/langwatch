import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { createLogger } from "@langwatch/observability";
import { NLP_INTERNAL_SECRET_ENV } from "@langwatch/process/nlp-internal-secret";
import {
  encodeScenarioEgressPolicy,
  encodeScenarioLogContext,
  isVoiceNonceRegisterMessage,
  SCENARIO_EGRESS_POLICY_ENV,
  SCENARIO_LOG_CONTEXT_ENV,
  VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON_ENV,
  type ScenarioEgressPolicy,
  type ScenarioLogContext,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import {
  type ScenarioChildBootstrap,
  type ScenarioChildExecutionSession,
  type ScenarioChildEnvironment,
} from "../../../app/scenario.app.ts";
import { handleVoiceNonceRegisterMessage } from "../../../channels/voice-nonce-handoff.channels.ts";
import { resolveChildTlsEnv } from "../../../rules/child-tls-env.rules.ts";
import type {
  ExecutionJobData,
  ScenarioExecutionPoolService,
} from "../../../services/scenario-execution-pool.service.ts";
import type { VoiceNonceRegistryService } from "../../voice/services/voice-nonce-registry.service.ts";
import type { VoicePublicUrl } from "../../voice/services/voice-public-url.service.ts";
import { ChildProcessSpawnService } from "./child-process-spawn.service.ts";
import { ScenarioChildSupervisorService } from "./scenario-child-supervisor.service.ts";

const logger = createLogger("langwatch:scenarios:child-process");

interface ScenarioChildParentEnvironment {
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
  logSettings?: Record<string, string | undefined>;
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

interface ScenarioChildTelemetry {
  endpoint: string;
  apiKey: string;
}

export class NodeScenarioChildService implements ScenarioChildBootstrap {
  static readonly parseResult = ScenarioChildSupervisorService.parseResult;
  static readonly buildEnvironment = buildChildEnvironmentValue;
  static readonly buildBaseEnvironment = buildBaseEnvironmentValue;
  static readonly buildOtelResourceAttributes = buildOtelResourceAttributesValue;

  static create(options: {
    config: ScenarioChildProcessConfig;
    /** Acquires the worker's public media origin, asked only when a voice child starts. */
    voicePublicUrl?: () => Promise<VoicePublicUrl>;
    pool: ScenarioExecutionPoolService;
    /** Where a voice child registers the media nonce the worker's door will be dialled with. */
    nonces: VoiceNonceRegistryService;
  }): NodeScenarioChildService {
    return new NodeScenarioChildService(options);
  }

  private constructor(
    private readonly options: {
      config: ScenarioChildProcessConfig;
      voicePublicUrl?: () => Promise<VoicePublicUrl>;
      pool: ScenarioExecutionPoolService;
      nonces: VoiceNonceRegistryService;
    },
  ) {}

  // An arrow instance property, not a prototype method: tests hold a bare
  // Object.create(prototype) instance and monkey-patch this directly to
  // assert on it, which is unsafe against a method-shorthand member.
  start = async (input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
  }): Promise<ScenarioChildExecutionSession> => {
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

    // A voice child needs the public origin in its environment; nothing else waits for it.
    const isVoiceChild = input.jobData.target.type === "voice";
    const voicePublicUrl =
      isVoiceChild && this.options.voicePublicUrl
        ? await this.options.voicePublicUrl()
        : this.options.config.voicePublicUrl;
    const childEnvironment = buildChildEnvironmentValue({
      config: { ...this.options.config, voicePublicUrl },
      jobData: input.jobData,
      labels: input.environment.labels,
      telemetry: input.environment.telemetry,
      callerEnv: input.environment.callerEnv,
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

    return ScenarioChildSupervisorService.supervise({
      child,
      jobData: input.jobData,
      pool: this.options.pool,
      log,
    });
  };
}

function buildChildEnvironmentValue(input: {
  config: ScenarioChildProcessConfig;
  jobData: ExecutionJobData;
  labels: string[];
  telemetry: ScenarioChildTelemetry;
  /** The caller's provider keys; forwarded to a voice child only, whatever the caller passes. */
  callerEnv?: Record<string, string> | undefined;
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
            ...input.callerEnv,
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
    ...parent.logSettings,
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

/** The public origin a voice child dials back through, or the reason the phone run names. */
function voicePublicUrlEnvironment(publicUrl: VoicePublicUrl | undefined): NodeJS.ProcessEnv {
  if (publicUrl === undefined) return {};
  if ("url" in publicUrl) return { VOICE_PUBLIC_BASE_URL: publicUrl.url };
  return { [VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON_ENV]: publicUrl.unavailable };
}
