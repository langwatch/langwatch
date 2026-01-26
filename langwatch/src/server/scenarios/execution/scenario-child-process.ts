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
  const { context, scenario, adapterData, modelParams, nlpServiceUrl } = jobData;

  const adapter = createAdapter({ adapterData, modelParams, nlpServiceUrl });
  const model = createModelFromParams(modelParams, nlpServiceUrl);

  // Results are reported via LangWatch SDK automatically
  const verbose = process.env.SCENARIO_VERBOSE === "true";
  const result = await ScenarioRunner.run(
    {
      id: scenario.id,
      name: scenario.name,
      description: scenario.situation,
      setId: context.setId,
      agents: [
        adapter,
        ScenarioRunner.userSimulatorAgent({ model }),
        ScenarioRunner.judgeAgent({ criteria: scenario.criteria, model }),
      ],
      verbose,
    },
    {
      batchRunId: context.batchRunId,
      langwatch: {
        endpoint: process.env.LANGWATCH_ENDPOINT!,
        apiKey: process.env.LANGWATCH_API_KEY!,
      },
    },
  );

  // Log the result but don't exit with error code for failed tests
  // A failed test is still a successful execution - results are reported via SDK
  if (result.success) {
    console.log(`Scenario passed`);
  } else {
    console.log(`Scenario failed: ${result.reasoning}`);
  }

  // Flush OTEL traces before exiting
  // The scenario SDK doesn't expose the observability handle, so we access
  // the global TracerProvider directly and call forceFlush/shutdown
  await flushOtelTraces();
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
      console.log("Flushing OTEL traces...");
      await concreteProvider.forceFlush();
      console.log("OTEL traces flushed");
    } else if (concreteProvider.shutdown) {
      console.log("Shutting down OTEL provider...");
      await concreteProvider.shutdown();
      console.log("OTEL provider shutdown complete");
    }
  } catch (error) {
    // Don't fail the scenario if OTEL flush fails
    console.warn(`OTEL flush warning: ${error instanceof Error ? error.message : String(error)}`);
  }
}

main().catch(async (error) => {
  console.error(`Scenario execution failed: ${error instanceof Error ? error.message : String(error)}`);
  // Still flush traces on error so we capture what happened
  await flushOtelTraces();
  process.exit(1);
});
