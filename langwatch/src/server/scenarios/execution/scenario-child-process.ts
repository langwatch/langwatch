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
 * 1. Parent sets LANGWATCH_API_KEY and LANGWATCH_ENDPOINT env vars
 * 2. This process imports @langwatch/scenario which calls setupObservability()
 *    at module load time, reading from those env vars
 * 3. Each child process gets its own OTEL TracerProvider
 *
 * IMPORTANT: We must flush OTEL traces before exiting. The scenario SDK doesn't
 * expose the observability handle, so we access the global TracerProvider directly.
 *
 * @see specs/scenarios/simulation-runner.feature (Worker-Based Execution scenarios)
 */

import { trace, type TracerProvider } from "@opentelemetry/api";
import * as ScenarioRunner from "@langwatch/scenario";
import type { ChildProcessJobData } from "./types";
import { createModelFromParams } from "./model.factory";
import { createAdapter } from "./serialized-adapter.registry";
import { RemoteSpanJudgeAgent } from "./remote-span-judge-agent";
import { createTraceApiSpanQuery } from "./trace-api-span-query";
import { SerializedHttpAgentAdapter } from "./serialized-adapters/http-agent.adapter";
import { bridgeTraceIdFromAdapterToJudge } from "./bridge-trace-id";
import { createChildProcessLogger } from "./child-logger";

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
        resolve(JSON.parse(data) as ChildProcessJobData);
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

  const langwatchEndpoint = process.env.LANGWATCH_ENDPOINT;
  const langwatchApiKey = process.env.LANGWATCH_API_KEY;
  if (!langwatchEndpoint) {
    throw new Error("LANGWATCH_ENDPOINT env var is required but not set");
  }
  if (!langwatchApiKey) {
    throw new Error("LANGWATCH_API_KEY env var is required but not set");
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

  // For HTTP targets, use a remote span judge that queries spans from
  // the platform API before evaluation. The trace ID will be captured
  // from the adapter after the conversation completes.
  let remoteSpanJudge: RemoteSpanJudgeAgent | undefined;
  const judgeAgent =
    target.type === "http"
      ? (() => {
          remoteSpanJudge = new RemoteSpanJudgeAgent({
            criteria: scenario.criteria,
            model: judgeModel,
            projectId: context.projectId,
            querySpans: createTraceApiSpanQuery({
              endpoint: langwatchEndpoint,
              apiKey: langwatchApiKey,
            }),
          });
          return remoteSpanJudge;
        })()
      : ScenarioRunner.judgeAgent({ criteria: scenario.criteria, model: judgeModel });

  // Results are reported via LangWatch SDK automatically
  const verbose = process.env.SCENARIO_VERBOSE === "true";

  // Hook into the scenario lifecycle to capture the trace ID from the adapter
  // before judge evaluation. The adapter captures it during HTTP calls.
  if (remoteSpanJudge && adapter instanceof SerializedHttpAgentAdapter) {
    bridgeTraceIdFromAdapterToJudge({ adapter, judge: remoteSpanJudge });
  }

  const result = await ScenarioRunner.run(
    {
      id: scenario.id,
      name: scenario.name,
      description: scenario.situation,
      setId: context.setId,
      agents: [
        adapter,
        ScenarioRunner.userSimulatorAgent({ model: simulatorModel }),
        judgeAgent,
      ],
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
  const outputResult: { success: boolean; reasoning?: string; error?: string } = {
    success: result.success,
  };
  if (result.reasoning) {
    outputResult.reasoning = result.reasoning;
  }
  process.stdout.write(JSON.stringify(outputResult) + "\n");
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
    const concreteProvider = (delegating.getDelegate?.() ?? provider) as FlushableTracerProvider;

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

main().catch(async (error) => {
  const errorMessage = error instanceof Error ? error.message : String(error);
  logger.error({ err: errorMessage }, "scenario execution failed");
  // Still flush traces on error so we capture what happened
  await flushOtelTraces();
  // Output JSON error result to stdout for parent process to parse
  process.stdout.write(JSON.stringify({ success: false, error: errorMessage }) + "\n");
  process.exit(1);
});
