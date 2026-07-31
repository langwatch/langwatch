/**
 * Child process entry point for isolated scenario execution.
 *
 * This process is self-contained and self-reporting:
 * - Receives job data via stdin
 * - Reports results via LangWatch SDK (OTEL traces/events)
 * - Exits with code 0 when execution completes (regardless of test pass/fail)
 * - Exits with code 1 only on actual errors (crashes, network failures, etc.)
 *
 * Note: A "failed" test result is still a successful execution - the scenario
 * ran to completion and reported its results. Only actual errors should cause
 * a non-zero exit code.
 *
 * OTEL isolation is achieved by:
 * 1. Parent injects LANGWATCH_API_KEY (project.apiKey) and LANGWATCH_ENDPOINT
 *    as env vars via buildChildProcessEnv in scenario.processor.ts
 * 2. This process imports @langwatch/scenario which calls setupObservability()
 *    at module load time, reading from those env vars
 * 3. Each child process gets its own OTEL TracerProvider
 *
 * IMPORTANT: We must flush OTEL traces before exiting. The scenario SDK doesn't
 * expose the observability handle, so we access the global TracerProvider directly.
 *
 * @see specs/scenarios/simulation-runner.feature (Worker-Based Execution scenarios)
 */

import * as ScenarioRunner from "@langwatch/scenario";
import { type TracerProvider, trace } from "@opentelemetry/api";
import { bridgeTraceIdFromAdapterToJudge } from "./bridge-trace-id";
import { createChildProcessLogger } from "./child-logger";
import { parseChildProcessJobData } from "./child-process-payload";
import { createModelFromParams } from "./model.factory";
import { RemoteSpanJudgeAgent } from "./remote-span-judge-agent";
import { createAdapter } from "./serialized-adapter.registry";
import { SerializedHttpAgentAdapter } from "./serialized-adapters/http-agent.adapter";
import { createTraceApiSpanQuery } from "./trace-api-span-query";
import { type ChildProcessJobData, RED_TEAM_DEFAULT_TURNS } from "./types";

const logger = createChildProcessLogger("langwatch:scenarios:child");

/**
 * Some TracerProvider implementations (like ProxyTracerProvider) wrap a delegate.
 * This interface allows accessing the underlying concrete provider.
 *
 * OpenTelemetry's ProxyTracerProvider is used when the SDK hasn't been fully
 * initialized yet, and it delegates to the real provider once available.
 * We need the concrete provider to call forceFlush/shutdown methods that
 * exist on the SDK's TracerProvider but not on the API's TracerProvider interface.
 */
interface DelegatingTracerProvider {
  getDelegate?(): TracerProvider;
}

/**
 * Extended TracerProvider interface that includes SDK-level methods.
 *
 * The @opentelemetry/api TracerProvider interface is minimal (just getTracer).
 * The SDK's TracerProvider adds forceFlush/shutdown for lifecycle management.
 * We use this interface with runtime checks since we can't know at compile time
 * whether the provider implements these methods.
 */
interface FlushableTracerProvider extends TracerProvider {
  forceFlush?(): Promise<void>;
  shutdown?(): Promise<void>;
}

async function main(): Promise<void> {
  const jobData = await readJobDataFromStdin();
  await executeScenario(jobData);
}

/**
 * Parses the scenario configuration, rather than casting it — see
 * `parseChildProcessJobData` for what is validated and what is not. A turn
 * budget past the cap is now a loud failure before the first model call
 * instead of fifty billed ones.
 */
async function readJobDataFromStdin(): Promise<ChildProcessJobData> {
  return new Promise((resolve, reject) => {
    let data = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        resolve(parseChildProcessJobData(data));
      } catch (error) {
        reject(new Error(`Failed to parse job data: ${error}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

async function executeScenario(jobData: ChildProcessJobData): Promise<void> {
  const {
    context,
    scenario,
    adapterData,
    modelParams,
    simulatorModelParams,
    judgeModelParams,
    nlpServiceUrl,
    target,
  } = jobData;

  // These are injected as env vars by the parent process (scenario.processor.ts
  // buildChildProcessEnv). They originate from prefetchScenarioData telemetry.
  const langwatchEndpoint = process.env.LANGWATCH_ENDPOINT;
  const langwatchApiKey = process.env.LANGWATCH_API_KEY;
  if (!langwatchEndpoint || !langwatchApiKey) {
    throw new Error(
      "LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env",
    );
  }

  const adapter = createAdapter({
    adapterData,
    modelParams,
    nlpServiceUrl,
  });
  // The user-simulator and judge resolve their own models (run-plan /
  // scenario override or the DEFAULT-role scenarios.* defaults). Older jobs
  // only carried modelParams, so fall back to it when the split params are
  // absent — preserves the previous single-model behavior during rollout.
  const simulatorModel = createModelFromParams(
    simulatorModelParams ?? modelParams,
    nlpServiceUrl,
  );
  const judgeModel = createModelFromParams(
    judgeModelParams ?? modelParams,
    nlpServiceUrl,
  );

  const { judgeAgent, remoteSpanJudge } = createJudge({
    isHttpTarget: target.type === "http",
    criteria: scenario.criteria,
    model: judgeModel,
    projectId: context.projectId,
    langwatchEndpoint,
    langwatchApiKey,
  });

  // Results are reported via LangWatch SDK automatically
  const verbose = process.env.SCENARIO_VERBOSE === "true";

  // Hook into the scenario lifecycle to capture the trace ID from the adapter
  // before judge evaluation. The adapter captures it during HTTP calls.
  if (remoteSpanJudge && adapter instanceof SerializedHttpAgentAdapter) {
    bridgeTraceIdFromAdapterToJudge({ adapter, judge: remoteSpanJudge });
  }

  const { agents, script } = buildConversation({
    adapter,
    scenario,
    simulatorModel,
    judgeAgent,
  });

  const result = await ScenarioRunner.run(
    {
      id: scenario.id,
      name: scenario.name,
      description: scenario.situation,
      setId: context.setId,
      agents,
      ...script,
      verbose,
      metadata: {
        langwatch: {
          targetReferenceId: target.referenceId,
          targetType: target.type,
        },
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

  // A failed test is still a successful execution — results are reported via SDK.
  if (result.success) {
    logger.info("scenario passed");
  } else {
    logger.warn({ reasoning: result.reasoning }, "scenario failed");
  }

  // Flush OTEL traces before exiting
  // The scenario SDK doesn't expose the observability handle, so we access
  // the global TracerProvider directly and call forceFlush/shutdown
  await flushOtelTraces();

  // Output JSON result to stdout for parent process to parse
  // Only stdout contains the JSON result; all other output goes to stderr
  const outputResult: { success: boolean; reasoning?: string; error?: string } =
    {
      success: result.success,
    };
  if (result.reasoning) {
    outputResult.reasoning = result.reasoning;
  }
  process.stdout.write(JSON.stringify(outputResult) + "\n");
}

/**
 * Who talks, and — for a red-team run — in what order.
 *
 * A red-team attacker IS a user simulator (it extends the same adapter), so it
 * drops straight into the simulator slot and everything downstream — the judge,
 * the criteria, the reporting — stays exactly as it is.
 *
 * marathonScript is what makes a red-team run a real one. Without it the judge
 * runs every turn and can end the scenario the moment nothing has gone wrong —
 * "must never reveal X" is satisfied by one clean exchange, so a 50-turn attack
 * finishes at turn one reporting that the agent held.
 *
 * The script is also the turn control. It expands to totalTurns rounds and the
 * runner walks it step by step, so maxTurns is not consulted on this path at
 * all (verified in the SDK: the scripted branch loops over script.length; the
 * maxTurns check lives in the auto-advance branch). Setting it here would be
 * dead config that reads like a safeguard.
 */
function buildConversation({
  adapter,
  scenario,
  simulatorModel,
  judgeAgent,
}: {
  adapter: ScenarioRunner.AgentAdapter;
  scenario: ChildProcessJobData["scenario"];
  simulatorModel: ReturnType<typeof createModelFromParams>;
  judgeAgent: ScenarioRunner.JudgeAgentAdapter;
}): {
  agents: ScenarioRunner.AgentAdapter[];
  script: { script?: ScenarioRunner.ScriptStep[] };
} {
  const redTeam = buildRedTeamAgent({ scenario, model: simulatorModel });
  const simulator =
    redTeam?.agent ??
    ScenarioRunner.userSimulatorAgent({ model: simulatorModel });
  return {
    agents: [adapter, simulator, judgeAgent],
    script: redTeam ? { script: redTeam.script } : {},
  };
}

/**
 * The judge, and the remote-span judge when there is one.
 *
 * An HTTP target's judge queries spans from the platform API before it
 * evaluates, so the caller needs the instance itself to bridge the adapter's
 * trace ID into it once the conversation is done. Every other target gets the
 * plain judge and no second reference.
 */
function createJudge({
  isHttpTarget,
  criteria,
  model,
  projectId,
  langwatchEndpoint,
  langwatchApiKey,
}: {
  isHttpTarget: boolean;
  criteria: string[];
  model: ReturnType<typeof createModelFromParams>;
  projectId: string;
  langwatchEndpoint: string;
  langwatchApiKey: string;
}): {
  judgeAgent: ScenarioRunner.JudgeAgentAdapter;
  remoteSpanJudge?: RemoteSpanJudgeAgent;
} {
  if (!isHttpTarget) {
    return { judgeAgent: ScenarioRunner.judgeAgent({ criteria, model }) };
  }
  const remoteSpanJudge = new RemoteSpanJudgeAgent({
    criteria,
    model,
    projectId,
    querySpans: createTraceApiSpanQuery({
      endpoint: langwatchEndpoint,
      apiKey: langwatchApiKey,
    }),
  });
  return { judgeAgent: remoteSpanJudge, remoteSpanJudge };
}

/**
 * Builds the adversarial attacker for a red-team scenario, or null for a
 * standard one.
 *
 * Returns the marathon script alongside the agent. The script is what the
 * runner walks, so it — not `maxTurns` — is what gives the attack its full
 * turn budget, and it is what stops the judge from ending the run at turn one
 * on a scenario where nothing has gone wrong yet.
 */
function buildRedTeamAgent({
  scenario,
  model,
}: {
  scenario: ChildProcessJobData["scenario"];
  model: ReturnType<typeof createModelFromParams>;
}): {
  agent: ScenarioRunner.UserSimulatorAgentAdapter;
  script: ScenarioRunner.ScriptStep[];
} | null {
  if (!scenario.redTeamStrategy || !scenario.redTeamTarget) return null;

  const totalTurns = scenario.redTeamTotalTurns ?? RED_TEAM_DEFAULT_TURNS;
  // Stored config first, so the three fields this function owns cannot be
  // overwritten by it. The other order happened to be safe only because
  // `RedTeamConfigSchema` is a stripping `z.object` on every write path today
  // — a cross-file invariant nothing states and nothing checks. Precedence
  // belongs where you can see it.
  const config = {
    ...(scenario.redTeamConfig ?? {}),
    target: scenario.redTeamTarget,
    totalTurns,
    model,
  };

  const agent =
    scenario.redTeamStrategy === "goat"
      ? ScenarioRunner.redTeamGoat(config)
      : ScenarioRunner.redTeamCrescendo(config);

  return { agent, script: agent.marathonScript() };
}

/**
 * Flush pending OTEL traces by accessing the global TracerProvider.
 * This ensures all traces are sent before the process exits.
 */
async function flushOtelTraces(): Promise<void> {
  try {
    const provider = trace.getTracerProvider();

    // The provider might be a ProxyTracerProvider wrapping the real one.
    // We need the concrete provider to access forceFlush/shutdown methods.
    const delegating = provider as DelegatingTracerProvider;
    const concreteProvider = (delegating.getDelegate?.() ??
      provider) as FlushableTracerProvider;

    // Try forceFlush first (preferred), then shutdown
    if (concreteProvider.forceFlush) {
      logger.debug("flushing otel traces");
      await concreteProvider.forceFlush();
      logger.debug("otel traces flushed");
    } else if (concreteProvider.shutdown) {
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
 * Flatten an error and its `cause` chain into a single string.
 *
 * Node's `fetch`/undici surface TLS and network failures as a generic
 * `TypeError: fetch failed` whose real reason (e.g. "self-signed certificate in
 * certificate chain", `SELF_SIGNED_CERT_IN_CHAIN`) lives on `error.cause`.
 * Reporting only `error.message` would drop that signal, so the parent — and
 * the failure classifier — would never see why the run died. Walk the chain and
 * include any error `code` so the classification is accurate.
 */
function formatErrorWithCauses(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = (current as { code?: unknown }).code;
      parts.push(
        typeof code === "string"
          ? `${current.message} (${code})`
          : current.message,
      );
      current = (current as { cause?: unknown }).cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.filter((p) => p.length > 0).join(": ");
}

main().catch(async (error) => {
  const errorMessage = formatErrorWithCauses(error);
  logger.error({ err: errorMessage }, "scenario execution failed");
  // Still flush traces on error so we capture what happened
  await flushOtelTraces();
  // Output JSON error result to stdout for parent process to parse
  process.stdout.write(
    JSON.stringify({ success: false, error: errorMessage }) + "\n",
  );
  process.exit(1);
});
