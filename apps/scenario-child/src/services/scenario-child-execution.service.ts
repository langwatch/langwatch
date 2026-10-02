/**
 * Child process entry point for isolated scenario execution.
 * @see specs/scenarios/simulation-runner.feature (Worker-Based Execution scenarios)
 */

import type { Logger } from "@langwatch/observability";
import * as ScenarioRunner from "@langwatch/scenario";
import {
  type CallLimitTimer,
  type ChildProcessJobData,
  createCallLimitTimer,
  DEFAULT_CALLER_VOICE,
} from "@langwatch/scenario-contract";
import { type TracerProvider, trace } from "@opentelemetry/api";

import type { ScenarioHttp } from "../channels/http/http.serialized-http-agent.channel.ts";
import { litellmModelChannels } from "../channels/litellm-model-channels.registry.ts";
import type { NlpFetchTimeouts } from "../channels/nlp-fetch.channel.ts";
import {
  SerializedAgentChannelRegistry,
  type VoiceAgentBuilder,
  type VoiceCallEnder,
} from "../channels/serialized-agent-channels.registry.ts";
import { SerializedAgentChannel } from "../channels/serialized-agent.channel.ts";
import {
  agentGreetsFirst,
  buildAgentGreetsFirstScript,
} from "../rules/agent-first-script.rules.ts";
import { buildCallerVoiceSimulatorConfig } from "../rules/caller-voice-simulator.rules.ts";
import { buildRemoteTraceRunConfig } from "../rules/remote-trace-run.rules.ts";
import { selectRoleModelParams } from "../rules/scenario-role-model.rules.ts";
import { AgentTestScriptService } from "./agent-test-script.service.ts";

/**
 * Some TracerProvider implementations (like ProxyTracerProvider) wrap a delegate. This interface
 * allows accessing the underlying concrete provider.
 */
function delegatedProvider(provider: TracerProvider): TracerProvider {
  if ("getDelegate" in provider && typeof provider.getDelegate === "function") {
    return provider.getDelegate() ?? provider;
  }
  return provider;
}

export interface ScenarioChildRuntime {
  langwatchEndpoint: string;
  langwatchApiKey: string;
  verbose: boolean;
  httpPort: ScenarioHttp;
  logger: Logger;
  /** The operator's nlpgo deadlines, read by the process that started this. */
  nlpTimeouts?: NlpFetchTimeouts;
  /** The engine hop's shared credential, as the parent stated it for this child. */
  nlpInternalSecret?: string | undefined;
  /** Builds a voice target's adapter over the transports, with this child's environment. */
  voiceAgents: VoiceAgentBuilder;
  /** Hangs up a voice target's live call when the whole-call limit elapses. */
  endVoiceCall: VoiceCallEnder;
}

export interface ScenarioChildExecutionResult {
  success: boolean;
  reasoning?: string;
  error?: string;
  /**
   * The connected agent instance that answered the run's turns, for the
   * parent's record of which process served the run. Absent for every other
   * kind of target.
   */
  agentInstance?: { hostname: string; label: string | null };
  /** LangWatch ended the voice call at the maximum call duration (AC28). */
  isCutAtLimit?: boolean;
}

/**
 * Voice-only run setup: the caller metadata recorded on the run (AC20, AC24) and the whole-call
 * timer that ends the call so the judge still runs on what was said (AC28).
 */
function buildVoiceRunSetup({
  jobData,
  adapter,
  runtime,
}: {
  jobData: ChildProcessJobData;
  adapter: ScenarioRunner.AgentAdapter;
  runtime: ScenarioChildRuntime;
}): { voiceMetadata: Record<string, unknown>; callLimitTimer: CallLimitTimer | null } {
  const { target, adapterData } = jobData;
  if (target.type !== "voice" || adapterData.type !== "voice") {
    return { voiceMetadata: {}, callLimitTimer: null };
  }
  const callerVoice = jobData.callerVoice ?? DEFAULT_CALLER_VOICE;
  const effectiveCaller = buildCallerVoiceSimulatorConfig(callerVoice);
  const voiceMetadata = {
    callerKind: "simulated" as const,
    caller: {
      voice: effectiveCaller.voice,
      interruptProbability: callerVoice.interruptProbability,
      effects: callerVoice.effects,
    },
  };
  const callLimitTimer = createCallLimitTimer({
    maxCallSeconds: adapterData.maxCallSeconds,
    onLimit: () => {
      runtime.logger.warn("voice call reached the max duration; ending the call");
      // Cleanup failure must not mask the run result.
      void runtime.endVoiceCall({ data: adapterData, adapter }).catch(() => undefined);
    },
  });
  return { voiceMetadata, callLimitTimer };
}

/**
 * Who takes part in the run, and whether the conversation is written down. A scripted run (an agent
 * test) carries its user's lines and decides its own verdict, so it builds no model.
 */
function buildRunCast({
  jobData,
  adapter,
  nlpInternalSecret,
}: {
  jobData: ChildProcessJobData;
  adapter: ScenarioRunner.AgentAdapter;
  nlpInternalSecret: string | undefined;
}): {
  agents: ScenarioRunner.AgentAdapter[];
  script?: ScenarioRunner.ScriptStep[];
} {
  if (jobData.script) {
    return AgentTestScriptService.create().build({
      adapter,
      script: jobData.script,
      doesAgentGreetFirst: agentGreetsFirst(jobData.adapterData),
    });
  }
  const { nlpServiceUrl, scenario } = jobData;
  const roleModelParams = selectRoleModelParams(jobData);
  const models = litellmModelChannels.live.create();
  // A voice target's user simulator speaks with the scenario's caller voice, interrupt
  // probability and audio effects; the judge and adapter are unchanged from a text run.
  const voiceSimConfig =
    jobData.target.type === "voice"
      ? buildCallerVoiceSimulatorConfig(jobData.callerVoice ?? DEFAULT_CALLER_VOICE)
      : null;
  const simulatorModel = models.model({
    litellmParams: roleModelParams.simulator,
    nlpServiceUrl,
    nlpInternalSecret,
  });
  const judgeModel = models.judgeModel({
    litellmParams: roleModelParams.judge,
    nlpServiceUrl,
    nlpInternalSecret,
  });
  // An inbound phone agent that greets on connect opens the run with its own
  // turn (so the greeting is captured first), then hands over to the
  // simulator/judge loop; every other run keeps the default cast, which opens
  // with the caller.
  const agentGreetsFirstScript = buildAgentGreetsFirstScript(jobData.adapterData);
  return {
    agents: [
      adapter,
      ScenarioRunner.userSimulatorAgent({ model: simulatorModel, ...voiceSimConfig }),
      ScenarioRunner.judgeAgent({
        criteria: scenario.criteria,
        model: judgeModel,
      }),
    ],
    ...(agentGreetsFirstScript ? { script: agentGreetsFirstScript } : {}),
  };
}

/**
 * The `maxTurns` override to pass to `ScenarioRunner.run`, if any. A judge-driven
 * agent-first run spends its opening turn on the greeting and the caller's
 * reply, unjudged, so it gets one extra turn to keep the same judged budget.
 */
function buildMaxTurnsRunConfig({
  jobData,
  scenarioMaxTurns,
}: {
  jobData: ChildProcessJobData;
  scenarioMaxTurns: number | null | undefined;
}): { maxTurns?: number } {
  const bumpForGreeting = !jobData.script && agentGreetsFirst(jobData.adapterData);
  if (scenarioMaxTurns == null && !bumpForGreeting) return {};
  return {
    maxTurns: (scenarioMaxTurns ?? ScenarioRunner.DEFAULT_MAX_TURNS) + (bumpForGreeting ? 1 : 0),
  };
}

async function executeScenarioChildValue({
  jobData,
  runtime,
}: {
  jobData: ChildProcessJobData;
  runtime: ScenarioChildRuntime;
}): Promise<ScenarioChildExecutionResult> {
  const { context, scenario, parameters, adapterData, modelParams, nlpServiceUrl, target } =
    jobData;

  const { langwatchEndpoint, langwatchApiKey, logger } = runtime;

  // The run's minted key rides LANGWATCH_API_KEY, the telemetry channel every
  // child already gets, so the job payload never carries it. The workflow and
  // code factories send it as workflow.api_key; prompt and http ignore it.
  const adapter = SerializedAgentChannelRegistry.create({
    nlpTimeouts: runtime.nlpTimeouts,
    voiceAgents: runtime.voiceAgents,
  }).build({
    adapterData,
    modelParams,
    nlpServiceUrl,
    nlpInternalSecret: runtime.nlpInternalSecret,
    projectApiKey: langwatchApiKey,
    parameters,
    httpPort: runtime.httpPort,
    logger,
  });
  const cast = buildRunCast({
    jobData,
    adapter,
    nlpInternalSecret: runtime.nlpInternalSecret,
  });
  const { voiceMetadata, callLimitTimer } = buildVoiceRunSetup({ jobData, adapter, runtime });

  // The timer clears on a rejected run too, or it could fire after the failure is reported.
  let result: Awaited<ReturnType<typeof ScenarioRunner.run>>;
  try {
    result = await ScenarioRunner.run(
      {
        id: scenario.id,
        name: scenario.name,
        description: scenario.situation,
        setId: context.setId,
        agents: cast.agents,
        ...(cast.script ? { script: cast.script } : {}),
        verbose: runtime.verbose,
        // An http target's own spans land in the trace each turn propagates,
        // so the judge fetches them back from the platform's trace API before
        // any verdict. The wait budget comes from the prefetcher's per-project
        // ingest-lag measurement.
        ...buildRemoteTraceRunConfig({
          targetType: target.type,
          traceWaitTimeoutMs: jobData.traceWaitTimeoutMs,
          langwatchEndpoint,
          langwatchApiKey,
        }),
        ...buildMaxTurnsRunConfig({
          jobData,
          scenarioMaxTurns: scenario.maxTurns,
        }),
        ...(scenario.minTurns != null && { minTurns: scenario.minTurns }),
        metadata: {
          langwatch: {
            targetReferenceId: target.referenceId,
            targetType: target.type,
            ...voiceMetadata,
          },
          ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
        },
      },
      {
        batchRunId: context.batchRunId,
        runId: jobData.scenarioRunId,
        langwatch: {
          endpoint: langwatchEndpoint,
          apiKey: langwatchApiKey,
        },
      },
    );
  } finally {
    callLimitTimer?.clear();
  }

  // A failed test is still a successful execution — results are reported via SDK.
  if (result.success) {
    logger.info("scenario passed");
  } else {
    logger.warn({ reasoning: result.reasoning }, "scenario failed");
  }

  // Flush OTEL traces before exiting
  // The scenario SDK doesn't expose the observability handle, so we access
  // the global TracerProvider directly and call forceFlush/shutdown
  await flushScenarioOtelTracesValue(logger);

  // Output JSON result to stdout for parent process to parse
  // Only stdout contains the JSON result; all other output goes to stderr
  const outputResult: ScenarioChildExecutionResult = {
    success: result.success,
  };
  if (result.reasoning) {
    outputResult.reasoning = result.reasoning;
  }
  // The connected agent instance that answered the run's turns, for the
  // parent's record of which process served the run.
  const servedInstance =
    adapter instanceof SerializedAgentChannel ? adapter.servedInstance : undefined;
  if (servedInstance) outputResult.agentInstance = servedInstance;
  // The parent records the marker so the run header can show "Cut at the call limit".
  if (callLimitTimer?.wasCut()) outputResult.isCutAtLimit = true;
  return outputResult;
}

/**
 * Flush pending OTEL traces by accessing the global TracerProvider.
 * This ensures all traces are sent before the process exits.
 */
async function flushScenarioOtelTracesValue(logger: Logger): Promise<void> {
  try {
    const provider = trace.getTracerProvider();

    // The provider might be a ProxyTracerProvider wrapping the real one.
    // We need the concrete provider to access forceFlush/shutdown methods.
    const concreteProvider = delegatedProvider(provider);

    // Try forceFlush first (preferred), then shutdown
    if ("forceFlush" in concreteProvider && typeof concreteProvider.forceFlush === "function") {
      logger.debug("flushing otel traces");
      await concreteProvider.forceFlush();
      logger.debug("otel traces flushed");
    } else if ("shutdown" in concreteProvider && typeof concreteProvider.shutdown === "function") {
      logger.debug("shutting down otel provider");
      await concreteProvider.shutdown();
      logger.debug("otel provider shutdown complete");
    }
  } catch (error) {
    // Don't fail the scenario if OTEL flush fails
    logger.warn(
      { err: error instanceof Error ? error.message : String(error) },
      "otel flush warning",
    );
  }
}

/**
 * Flatten an error and its `cause` chain into a single string. Node's `fetch`/undici surface TLS
 * and network failures as a generic `TypeError: fetch failed` whose real reason (e.g. "self-signed
 * certificate in certificate chain", `SELF_SIGNED_CERT_IN_CHAIN`) lives on `error.cause`.
 */
function formatScenarioChildErrorValue(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = "code" in current ? current.code : void 0;
      parts.push(typeof code === "string" ? `${current.message} (${code})` : current.message);
      current = current.cause;
    } else {
      parts.push(typeof current === "string" ? current : (JSON.stringify(current) ?? ""));
      break;
    }
  }
  return parts.filter((p) => p.length > 0).join(": ");
}

export class ScenarioChildExecutionService {
  static create(): ScenarioChildExecutionService {
    return new ScenarioChildExecutionService();
  }

  private constructor() {}

  static readonly execute = executeScenarioChildValue;
  static readonly flushTraces = flushScenarioOtelTracesValue;
  static readonly formatError = formatScenarioChildErrorValue;
}

export const executeScenarioChild = ScenarioChildExecutionService.execute;
export const flushScenarioOtelTraces = ScenarioChildExecutionService.flushTraces;
export const formatScenarioChildError = ScenarioChildExecutionService.formatError;
