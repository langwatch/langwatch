/**
 * Child process entry point for isolated scenario execution.
 * @see specs/scenarios/simulation-runner.feature (Worker-Based Execution scenarios)
 */

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type { AgentHooks } from "@langwatch/agent-contract";
import type { Logger } from "@langwatch/observability";
import * as ScenarioRunner from "@langwatch/scenario";
import {
  type CallLimitTimer,
  CHILD_PROCESS,
  type ChildProcessJobData,
  createCallLimitTimer,
  RED_TEAM_BREAK_SCORE,
  type RedTeamConfig,
  type RedTeamRunReport,
  type ScenarioRunHooks,
  DEFAULT_CALLER_VOICE,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { type TracerProvider, trace } from "@opentelemetry/api";
import { wrapLanguageModel } from "ai";

import {
  type ConnectedCallRun,
  HttpSerializedConnectedAgentChannel,
} from "../channels/http/http.serialized-connected-agent.channel.ts";
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
import {
  addOpeningUserTurn,
  ATTACKER_EMPTY_REPLY_RETRIES,
  AttackerNoReplyError,
  hasReplyText,
  isAttackerNoReply,
  buildRedTeamRunReport,
  getRedTeamRunConfig,
  isRedTeamRun,
  RED_TEAM_TIME_MARGIN_MS,
  readRedTeamTurnScores,
  redTeamTotalTurns,
  EARLY_EXIT_REASONING_PREFIX,
} from "../rules/red-team-run.rules.ts";
import { buildRemoteTraceRunConfig } from "../rules/remote-trace-run.rules.ts";
import { selectRoleModelParams } from "../rules/scenario-role-model.rules.ts";
import { AgentTestScriptService } from "./agent-test-script.service.ts";
import { RunStateRolesService } from "./run-state-roles.service.ts";
import { ScenarioRunHooksError, ScenarioRunHooksService } from "./scenario-run-hooks.service.ts";

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
  /** A red team run's outcome and per-turn scores. */
  redTeam?: RedTeamRunReport;
  /** The setup and teardown the run called, when the agent declared any (ADR-180). */
  hooks?: ScenarioRunHooks;
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
  readState,
}: {
  jobData: ChildProcessJobData;
  adapter: ScenarioRunner.AgentAdapter;
  nlpInternalSecret: string | undefined;
  /** The run's hook state, which the simulated user and the judge then see on every turn. */
  readState?: () => Record<string, unknown> | null;
}): {
  agents: ScenarioRunner.AgentAdapter[];
  script?: ScenarioRunner.ScriptStep[];
  redTeam?: RedTeamCast;
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
  const baseJudge = ScenarioRunner.judgeAgent({ criteria: scenario.criteria, model: judgeModel });
  if (isRedTeamRun(scenario)) {
    return buildRedTeamCast({ adapter, scenario, simulatorModel, judge: baseJudge });
  }
  // An inbound phone agent that greets on connect opens the run with its own
  // turn (so the greeting is captured first), then hands over to the
  // simulator/judge loop; every other run keeps the default cast, which opens
  // with the caller.
  const agentGreetsFirstScript = buildAgentGreetsFirstScript(jobData.adapterData);
  const roles = {
    userSimulator: ScenarioRunner.userSimulatorAgent({ model: simulatorModel, ...voiceSimConfig }),
    judge: baseJudge,
  };
  const { userSimulator, judge } = readState
    ? RunStateRolesService.create({ readState }).wrap(roles)
    : roles;
  return {
    agents: [adapter, userSimulator, judge],
    ...(agentGreetsFirstScript ? { script: agentGreetsFirstScript } : {}),
  };
}

/** The attacker a red team run plays in place of the user simulator, kept to read its scores. */
interface RedTeamCast {
  attacker: ScenarioRunner.AgentAdapter;
  config: RedTeamConfig;
  totalTurns: number;
  progress: { turnsRun: number };
}

/**
 * The attack turns, then the judge. A break ends the run as failed on the spot, so the finished
 * run already carries the failure for the suite and every other reader of it. Once time is short
 * of the child timeout, or the attacker model stays silent, the judge rules on the turns played.
 */
export function redTeamScript({
  attacker,
  totalTurns,
  progress,
  isOutOfTime,
}: {
  attacker: { checkEarlyExit(): boolean };
  totalTurns: number;
  progress: { turnsRun: number };
  isOutOfTime: () => boolean;
}): ScenarioRunner.ScriptStep[] {
  const steps: ScenarioRunner.ScriptStep[] = [];
  const attackerTurn: ScenarioRunner.ScriptStep = async (_state, executor) => {
    try {
      await executor.user();
    } catch (error) {
      if (!isAttackerNoReply(error)) throw error;
      await executor.judge();
    }
  };
  for (let turn = 0; turn < totalTurns; turn++) {
    steps.push(attackerTurn, ScenarioRunner.agent(), async (state, executor) => {
      progress.turnsRun += 1;
      if (attacker.checkEarlyExit()) {
        await executor.fail(`${EARLY_EXIT_REASONING_PREFIX} on turn ${state.currentTurn}`);
        return;
      }
      if (progress.turnsRun < totalTurns && isOutOfTime()) await executor.judge();
    });
  }
  steps.push(ScenarioRunner.judge());
  return steps;
}

/**
 * The attacker opens its first turn with only a system prompt, which Gemini refuses as empty
 * contents; a prompt with no user or assistant message gains one user turn.
 */
export function withOpeningUserTurn(model: LanguageModelV3): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      transformParams: async ({ params }) => ({
        ...params,
        prompt: addOpeningUserTurn(params.prompt),
      }),
    },
  });
}

/** An attacker reply with no text is asked again a few times before the attack ends. */
export function withEmptyReplyRetry(model: LanguageModelV3): LanguageModelV3 {
  return wrapLanguageModel({
    model,
    middleware: {
      specificationVersion: "v3",
      wrapGenerate: async ({ doGenerate }) => {
        const attempts = ATTACKER_EMPTY_REPLY_RETRIES + 1;
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const result = await doGenerate();
          if (hasReplyText(result.content)) return result;
        }
        throw new AttackerNoReplyError(attempts);
      },
    },
  });
}

/**
 * A red team run's cast: the attacker plays the user with the simulator's model for attacks and
 * its plan, the judge holds the scenario criteria, and the marathon script runs the turn budget.
 */
export function buildRedTeamCast({
  adapter,
  scenario,
  simulatorModel,
  judge,
}: {
  adapter: ScenarioRunner.AgentAdapter;
  scenario: ChildProcessJobData["scenario"];
  simulatorModel: LanguageModelV3;
  judge: ScenarioRunner.AgentAdapter;
}): {
  agents: ScenarioRunner.AgentAdapter[];
  script: ScenarioRunner.ScriptStep[];
  redTeam: RedTeamCast;
} {
  const config = getRedTeamRunConfig(scenario);
  const totalTurns = redTeamTotalTurns(config.maxTurns);
  const progress = { turnsRun: 0 };
  const turnsEndAt =
    nowInstant().epochMilliseconds + CHILD_PROCESS.TIMEOUT_MS - RED_TEAM_TIME_MARGIN_MS;
  const isOutOfTime = () => nowInstant().epochMilliseconds >= turnsEndAt;
  const attackerModel = withEmptyReplyRetry(withOpeningUserTurn(simulatorModel));
  const attackerConfig = {
    target: config.attackGoal,
    totalTurns,
    model: attackerModel,
    metapromptModel: attackerModel,
    successScore: RED_TEAM_BREAK_SCORE,
  };
  const attacker =
    config.strategy === "goat"
      ? ScenarioRunner.redTeamGoat(attackerConfig)
      : ScenarioRunner.redTeamCrescendo(attackerConfig);
  return {
    agents: [adapter, attacker, judge],
    script: redTeamScript({ attacker, totalTurns, progress, isOutOfTime }),
    redTeam: { attacker, config, totalTurns, progress },
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

/**
 * The connected agent a scenario run calls hooks on, with the hooks it declared, or null when the
 * run calls none. An agent test calls none.
 */
function hookTargetOf({
  jobData,
  adapter,
}: {
  jobData: ChildProcessJobData;
  adapter: ScenarioRunner.AgentAdapter;
}): { caller: HttpSerializedConnectedAgentChannel; declared: AgentHooks } | null {
  const { adapterData } = jobData;
  if (jobData.script || adapterData.type !== "connected") return null;
  const declared = adapterData.hooks;
  if (!declared?.setup && !declared?.teardown) return null;
  if (!(adapter instanceof HttpSerializedConnectedAgentChannel)) return null;
  return { caller: adapter, declared };
}

/** The scenario run every connected agent call names (ADR-180). */
function callRunOf(jobData: ChildProcessJobData): ConnectedCallRun {
  return {
    ...(jobData.scenarioRunId ? { scenarioRunId: jobData.scenarioRunId } : {}),
    scenarioName: jobData.scenario.name,
    batchRunId: jobData.context.batchRunId,
  };
}

/** The run's turns through the scenario library, up to its verdict. */
function runScenarioTurns({
  jobData,
  runtime,
  cast,
  voiceMetadata,
}: {
  jobData: ChildProcessJobData;
  runtime: ScenarioChildRuntime;
  cast: ReturnType<typeof buildRunCast>;
  voiceMetadata: Record<string, unknown>;
}): ReturnType<typeof ScenarioRunner.run> {
  const { context, scenario, parameters, target } = jobData;
  const { langwatchEndpoint, langwatchApiKey } = runtime;
  return ScenarioRunner.run(
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
      // ingest-lag measurement unless the plan or scenario set one.
      ...buildRemoteTraceRunConfig({
        targetType: target.type,
        traceWaitTimeoutMs: jobData.traceWaitTimeoutMs,
        traceQuietPeriodMs: jobData.traceQuietPeriodMs,
        langwatchEndpoint,
        langwatchApiKey,
      }),
      // A red team script plays its whole budget, plus the judge's closing turn.
      ...(cast.redTeam
        ? { maxTurns: cast.redTeam.totalTurns + 1 }
        : buildMaxTurnsRunConfig({ jobData, scenarioMaxTurns: scenario.maxTurns })),
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
}

async function executeScenarioChildValue({
  jobData,
  runtime,
}: {
  jobData: ChildProcessJobData;
  runtime: ScenarioChildRuntime;
}): Promise<ScenarioChildExecutionResult> {
  const { parameters, adapterData, modelParams, nlpServiceUrl, executeSyncRoute } = jobData;

  const { langwatchApiKey, logger } = runtime;

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
    executeSyncRoute,
    parameters,
    httpPort: runtime.httpPort,
    logger,
    run: callRunOf(jobData),
  });
  const hookTarget = hookTargetOf({ jobData, adapter });
  const cast = buildRunCast({
    jobData,
    adapter,
    nlpInternalSecret: runtime.nlpInternalSecret,
    ...(hookTarget ? { readState: () => hookTarget.caller.runState } : {}),
  });
  const { voiceMetadata, callLimitTimer } = buildVoiceRunSetup({ jobData, adapter, runtime });
  const runTurns = () => runScenarioTurns({ jobData, runtime, cast, voiceMetadata });

  // The timer clears on a rejected run too, or it could fire after the failure is reported.
  let ran: { value: Awaited<ReturnType<typeof ScenarioRunner.run>>; hooks?: ScenarioRunHooks };
  try {
    ran = hookTarget
      ? await ScenarioRunHooksService.create({ ...hookTarget, keepData: jobData.keepData }).around(
          runTurns,
        )
      : { value: await runTurns() };
  } finally {
    callLimitTimer?.clear();
  }
  const { value: result, hooks } = ran;

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
  if (hooks) outputResult.hooks = hooks;
  if (cast.redTeam) {
    outputResult.redTeam = buildRedTeamRunReport({
      config: cast.redTeam.config,
      totalTurns: cast.redTeam.totalTurns,
      judgePassed: result.success,
      reasoning: result.reasoning,
      turnScores: readRedTeamTurnScores(cast.redTeam.attacker),
      turnsRun: cast.redTeam.progress.turnsRun,
    });
  }
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

/** The result line of a run that threw: the error, and the hooks it called when it had any. */
function failureLineValue(error: unknown): ScenarioChildExecutionResult {
  if (error instanceof ScenarioRunHooksError) {
    return {
      success: false,
      error: formatScenarioChildErrorValue(error.reason),
      hooks: error.hooks,
    };
  }
  return { success: false, error: formatScenarioChildErrorValue(error) };
}

export class ScenarioChildExecutionService {
  static create(): ScenarioChildExecutionService {
    return new ScenarioChildExecutionService();
  }

  private constructor() {}

  static readonly execute = executeScenarioChildValue;
  static readonly flushTraces = flushScenarioOtelTracesValue;
  static readonly failureLine = failureLineValue;
}

export const executeScenarioChild = ScenarioChildExecutionService.execute;
export const flushScenarioOtelTraces = ScenarioChildExecutionService.flushTraces;
export const scenarioChildFailureLine = ScenarioChildExecutionService.failureLine;
