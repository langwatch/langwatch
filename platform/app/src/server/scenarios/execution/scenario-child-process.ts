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
import { buildAgentTestRun } from "./agent-test-script";
import { createChildProcessLogger } from "./child-logger";
import { selectRoleModelParams } from "./job-model-params";
import {
  createJudgeModelFromParams,
  createModelFromParams,
} from "./model.factory";
import { buildRemoteTraceRunConfig } from "./remote-trace-run-config";
import { createAdapter } from "./serialized-adapter.registry";
import { SerializedConnectedAgentAdapter } from "./serialized-adapters/connected-agent.adapter";
import { type ChildProcessJobData, ChildProcessJobDataSchema } from "./types";

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

async function readJobDataFromStdin(): Promise<ChildProcessJobData> {
  return new Promise((resolve, reject) => {
    let data = "";

    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      try {
        // A real .parse(), not an unchecked cast: every model-params field
        // is individually optional (workflow/code/http targets resolve no
        // adapter model; a pre-split payload carries only modelParams), so
        // the schema's refinement is what guarantees each role can be built.
        // A payload that fails it must fail loudly here with a named Zod
        // error rather than as an opaque "undefined has no properties" crash
        // three layers into model construction (issue #6634).
        resolve(ChildProcessJobDataSchema.parse(JSON.parse(data)));
      } catch (error) {
        reject(new Error(`Failed to parse job data: ${error}`));
      }
    });
    process.stdin.on("error", reject);
  });
}

/**
 * The telemetry endpoint and key the run reports to.
 *
 * The parent process injects them as env vars (buildChildProcessEnv in
 * scenario.processor.ts) and they come from prefetchScenarioData telemetry.
 */
function readTelemetryEnv(): {
  langwatchEndpoint: string;
  langwatchApiKey: string;
} {
  const langwatchEndpoint = process.env.LANGWATCH_ENDPOINT;
  const langwatchApiKey = process.env.LANGWATCH_API_KEY;
  if (!langwatchEndpoint || !langwatchApiKey) {
    throw new Error(
      "LANGWATCH_ENDPOINT and LANGWATCH_API_KEY must be set in child process env",
    );
  }
  return { langwatchEndpoint, langwatchApiKey };
}

async function executeScenario(jobData: ChildProcessJobData): Promise<void> {
  const {
    context,
    scenario,
    parameters,
    adapterData,
    modelParams,
    nlpServiceUrl,
    target,
  } = jobData;

  const { langwatchEndpoint, langwatchApiKey } = readTelemetryEnv();

  // The platform API key rides the same telemetry channel every child
  // process already gets (buildChildProcessEnv in scenario.processor.ts
  // sets LANGWATCH_API_KEY from prefetchScenarioData's telemetry.apiKey) —
  // no need to duplicate it onto the job payload. The workflow/code
  // factories consume it as workflow.api_key; prompt and http ignore it.
  const adapter = createAdapter({
    adapterData,
    modelParams,
    nlpServiceUrl,
    projectApiKey: langwatchApiKey,
    parameters,
  });
  const cast = buildRunCast({ jobData, adapter });

  // Results are reported via LangWatch SDK automatically
  const verbose = process.env.SCENARIO_VERBOSE === "true";

  const result = await ScenarioRunner.run(
    {
      id: scenario.id,
      name: scenario.name,
      description: scenario.situation,
      setId: context.setId,
      agents: cast.agents,
      ...(cast.script ? { script: cast.script } : {}),
      verbose,
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
      ...(scenario.maxTurns != null && { maxTurns: scenario.maxTurns }),
      ...(scenario.minTurns != null && { minTurns: scenario.minTurns }),
      metadata: {
        langwatch: {
          targetReferenceId: target.referenceId,
          targetType: target.type,
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
  const outputResult: {
    success: boolean;
    reasoning?: string;
    error?: string;
    agentInstance?: { hostname: string; label: string | null };
  } = {
    success: result.success,
  };
  if (result.reasoning) {
    outputResult.reasoning = result.reasoning;
  }
  // The connected agent instance that answered the run's turns, for the
  // parent's record of which process served the run.
  if (
    adapter instanceof SerializedConnectedAgentAdapter &&
    adapter.servedInstance
  ) {
    outputResult.agentInstance = adapter.servedInstance;
  }
  // The result line is the last thing the child says. Exit once it is
  // written rather than wait for the event loop to drain: the run's adapters
  // and the SDK can leave handles open after the run, and a child that stays
  // up keeps the parent from reading the result until its timeout.
  process.stdout.write(JSON.stringify(outputResult) + "\n", () => {
    process.exit(0);
  });
}

/**
 * Who takes part in the run, and whether the conversation is written down.
 *
 * A scripted run (an agent test) carries its user's lines and decides its
 * own verdict, so it builds no model. Every other run lets a user simulator
 * play the person and a judge decide: both resolve their own models (run-plan
 * or scenario override, else the DEFAULT-role scenarios.* defaults). A job
 * queued before that split carried only modelParams, so both roles fall
 * back to it, preserving the previous single-model behavior across a deploy.
 */
function buildRunCast({
  jobData,
  adapter,
}: {
  jobData: ChildProcessJobData;
  adapter: ScenarioRunner.AgentAdapter;
}): {
  agents: ScenarioRunner.AgentAdapter[];
  script?: ScenarioRunner.ScriptStep[];
} {
  if (jobData.script) {
    return buildAgentTestRun({ adapter, script: jobData.script });
  }
  const { nlpServiceUrl, scenario } = jobData;
  const roleModelParams = selectRoleModelParams(jobData);
  const simulatorModel = createModelFromParams({
    litellmParams: roleModelParams.simulator,
    nlpServiceUrl,
  });
  const judgeModel = createJudgeModelFromParams({
    litellmParams: roleModelParams.judge,
    nlpServiceUrl,
  });
  return {
    agents: [
      adapter,
      ScenarioRunner.userSimulatorAgent({ model: simulatorModel }),
      ScenarioRunner.judgeAgent({
        criteria: scenario.criteria,
        model: judgeModel,
      }),
    ],
  };
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
