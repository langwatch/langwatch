/**
 * Starts a scenario run in a Node child (apps/scenario-child) and builds the allow-listed
 * environment every scenario child, Node or Go, is started with.
 * @see specs/scenarios/pre-compiled-child-process.feature
 */

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
  type ScenarioServerConfig,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";

import type {
  ScenarioChildEnvironment,
  ScenarioChildExecutionSession,
} from "../app/scenario.app.ts";
import type { VoicePublicUrl } from "../features/voice/services/voice-public-url.service.ts";
import { resolveChildTlsEnv } from "../rules/child-tls-env.rules.ts";
import type { ExecutionJobData } from "../services/scenario-execution-pool.service.ts";
import type {
  ScenarioChildChannel,
  ScenarioChildNonceRegistry,
  ScenarioChildRunPool,
} from "./scenario-child.channel.ts";
import { ScenarioChildSpawn } from "./scenario-child.spawn.channel.ts";
import { superviseScenarioChild } from "./scenario-child.supervisor.channel.ts";
import { handleVoiceNonceRegisterMessage } from "./voice-nonce-handoff.channels.ts";

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

/** The repository root: this file sits five folders below it, in source and in dist alike. */
const WORKSPACE_ROOT = path.join(import.meta.dirname, "..", "..", "..", "..", "..");
const CHILD_PACKAGE_ROOT = path.join(WORKSPACE_ROOT, "apps", "scenario-child");

/** How a scenario child is started here, whether it runs a simulation or one agent-test turn. */
export function scenarioChildProcessConfig({
  config,
  nlpInternalSecret,
}: {
  config: ScenarioServerConfig;
  nlpInternalSecret: string | undefined;
}): ScenarioChildProcessConfig {
  return {
    packageRoot: CHILD_PACKAGE_ROOT,
    sourcePath: path.join(CHILD_PACKAGE_ROOT, "src", "main.ts"),
    sourceRoots: [
      path.join(CHILD_PACKAGE_ROOT, "src"),
      path.join(WORKSPACE_ROOT, "modules", "scenario", "contract", "src"),
      path.join(WORKSPACE_ROOT, "modules", "scenario", "process", "src", "channels"),
    ],
    nodeEnv: config.nodeEnvironment,
    isSaas: config.isSaas,
    baseHost: config.publicBaseUrl,
    egress: {
      blockLocal: config.blockLocalHttpCalls,
      allowedHosts: [...config.allowedProxyHosts],
    },
    nlpInternalSecret,
    parentEnvironment: config.childParentEnvironment,
  };
}

export class NodeScenarioChildChannel implements ScenarioChildChannel {
  static create(options: { config: ScenarioChildProcessConfig }): NodeScenarioChildChannel {
    return new NodeScenarioChildChannel(options.config);
  }

  private constructor(private readonly config: ScenarioChildProcessConfig) {}

  // An arrow instance property, not a prototype method: tests hold a bare
  // Object.create(prototype) instance and monkey-patch this directly to
  // assert on it, which is unsafe against a method-shorthand member.
  start = async (input: {
    jobData: ExecutionJobData;
    environment: ScenarioChildEnvironment;
    pool: ScenarioChildRunPool;
    nonces: ScenarioChildNonceRegistry;
    voicePublicUrl?: () => Promise<VoicePublicUrl>;
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
      isVoiceChild && input.voicePublicUrl
        ? await input.voicePublicUrl()
        : this.config.voicePublicUrl;
    const childEnvironment = buildChildEnvironment({
      config: { ...this.config, voicePublicUrl },
      jobData: input.jobData,
      labels: input.environment.labels,
      telemetry: input.environment.telemetry,
      callerEnv: input.environment.callerEnv,
    });
    const spawnConfig = ScenarioChildSpawn.create().resolve({
      packageRoot: this.config.packageRoot,
      nodeEnv: this.config.nodeEnv,
      sourcePath: this.config.sourcePath,
      sourceRoots: this.config.sourceRoots,
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
      cwd: this.config.packageRoot,
    });
    if (isVoiceChild) {
      child.on("message", (message: unknown) => {
        if (!isVoiceNonceRegisterMessage(message)) return;
        void handleVoiceNonceRegisterMessage({
          message,
          child,
          registry: input.nonces,
        }).then((ack) => child.send?.(ack));
      });
    }
    log("info", "Child process spawned", {
      pid: child.pid,
      spawnMs: nowInstant().epochMilliseconds - spawnStartedAt,
    });

    return superviseScenarioChild({ child, jobData: input.jobData, pool: input.pool, log });
  };
}

/** A run child's environment: the base every child gets, plus a voice child's origin and keys. */
export function buildChildEnvironment(input: {
  config: ScenarioChildProcessConfig;
  jobData: ExecutionJobData;
  labels: string[];
  telemetry: ScenarioChildTelemetry;
  /** The caller's provider keys; forwarded to a voice child only, whatever the caller passes. */
  callerEnv?: Record<string, string> | undefined;
}): NodeJS.ProcessEnv {
  return buildBaseEnvironment({
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
export function buildBaseEnvironment(input: {
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
    OTEL_RESOURCE_ATTRIBUTES: buildOtelResourceAttributes(input.labels),
    [SCENARIO_EGRESS_POLICY_ENV]: encodeScenarioEgressPolicy(input.config.egress),
    ...input.extra,
    [SCENARIO_LOG_CONTEXT_ENV]: encodeScenarioLogContext(input.logContext),
    ...tlsEnvironment,
  });
}

export function buildOtelResourceAttributes(labels: string[]): string {
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

/** The public origin a voice child dials back through, or the reason the phone run names. */
function voicePublicUrlEnvironment(publicUrl: VoicePublicUrl | undefined): NodeJS.ProcessEnv {
  if (publicUrl === undefined) return {};
  if ("url" in publicUrl) return { VOICE_PUBLIC_BASE_URL: publicUrl.url };
  return { [VOICE_PUBLIC_BASE_URL_UNAVAILABLE_REASON_ENV]: publicUrl.unavailable };
}
