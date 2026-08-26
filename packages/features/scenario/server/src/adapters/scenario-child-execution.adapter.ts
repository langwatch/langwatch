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
import type { Logger } from "@langwatch/observability";
import { buildRemoteTraceRunConfig } from "./remote-trace-run.adapter";
import { createAdapter } from "./serialized-agent-registry.adapter";
import {
  createJudgeModelFromParams,
  createModelFromParams,
} from "./litellm-model.adapter";
import { selectRoleModelParams } from "./scenario-role-model.adapter";
import type { ChildProcessJobData } from "@langwatch/scenario-contract";
import type { ScenarioHttpPort } from "../ports/scenario-http.port";

/**
 * Some TracerProvider implementations (like ProxyTracerProvider) wrap a delegate.
 * This interface allows accessing the underlying concrete provider.
 *
 * OpenTelemetry's ProxyTracerProvider is used when the SDK hasn't been fully
 * initialized yet, and it delegates to the real provider once available.
 * We need the concrete provider to call forceFlush/shutdown methods that
 * exist on the SDK's TracerProvider but not on the API's TracerProvider interface.
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
  httpPort: ScenarioHttpPort;
  logger: Logger;
}

export interface ScenarioChildExecutionResult {
  success: boolean;
  reasoning?: string;
  error?: string;
}

async function executeScenarioChildValue({
  jobData,
  runtime,
}: {
  jobData: ChildProcessJobData;
  runtime: ScenarioChildRuntime;
}): Promise<ScenarioChildExecutionResult> {
  const {
    context,
    scenario,
    parameters,
    adapterData,
    modelParams,
    nlpServiceUrl,
    target,
  } = jobData;

  const { langwatchEndpoint, langwatchApiKey, logger } = runtime;

  // The platform API key rides the same telemetry channel every child
  // process already gets (buildChildProcessEnv in scenario.processor.ts
  // sets LANGWATCH_API_KEY from the prefetched project telemetry key —
  // no need to duplicate it onto the job payload. The workflow/code
  // factories consume it as workflow.api_key; prompt and http ignore it.
  const adapter = createAdapter({
    adapterData,
    modelParams,
    nlpServiceUrl,
    projectApiKey: langwatchApiKey,
    parameters,
    httpPort: runtime.httpPort,
    logger,
  });
  // The user-simulator and judge resolve their own models (run-plan /
  // scenario override or the DEFAULT-role scenarios.* defaults). A job queued
  // before that split carried only modelParams, so both roles fall back to it
  // — preserving the previous single-model behavior across a deploy.
  const roleModelParams = selectRoleModelParams(jobData);
  const simulatorModel = createModelFromParams({
    litellmParams: roleModelParams.simulator,
    nlpServiceUrl,
  });
  const judgeModel = createJudgeModelFromParams({
    litellmParams: roleModelParams.judge,
    nlpServiceUrl,
  });

  const judgeAgent = ScenarioRunner.judgeAgent({
    criteria: scenario.criteria,
    model: judgeModel,
  });

  // Results are reported via LangWatch SDK automatically
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
  await flushScenarioOtelTracesValue(logger);

  // Output JSON result to stdout for parent process to parse
  // Only stdout contains the JSON result; all other output goes to stderr
  const outputResult: ScenarioChildExecutionResult = {
    success: result.success,
  };
  if (result.reasoning) {
    outputResult.reasoning = result.reasoning;
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
    if (
      "forceFlush" in concreteProvider &&
      typeof concreteProvider.forceFlush === "function"
    ) {
      logger.debug("flushing otel traces");
      await concreteProvider.forceFlush();
      logger.debug("otel traces flushed");
    } else if (
      "shutdown" in concreteProvider &&
      typeof concreteProvider.shutdown === "function"
    ) {
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
function formatScenarioChildErrorValue(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      const code = "code" in current ? current.code : void 0;
      parts.push(
        typeof code === "string" ? `${current.message} (${code})` : current.message,
      );
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }
  return parts.filter((p) => p.length > 0).join(": ");
}

export class ScenarioChildExecutionAdapter {
  static create(): ScenarioChildExecutionAdapter {
    return new ScenarioChildExecutionAdapter();
  }

  private constructor() {}

  static readonly execute = executeScenarioChildValue;
  static readonly flushTraces = flushScenarioOtelTracesValue;
  static readonly formatError = formatScenarioChildErrorValue;
}

export const executeScenarioChild = ScenarioChildExecutionAdapter.execute;
export const flushScenarioOtelTraces = ScenarioChildExecutionAdapter.flushTraces;
export const formatScenarioChildError = ScenarioChildExecutionAdapter.formatError;
