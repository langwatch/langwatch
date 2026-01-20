/**
 * Scenario Worker Script
 *
 * This script runs in an isolated worker thread with its own OpenTelemetry setup.
 * It receives pre-fetched scenario configuration and executes the scenario,
 * sending traces to LangWatch instead of the server's global OTEL exporter.
 *
 * Architecture:
 * - Worker thread has its own V8 isolate
 * - Sets up independent OTEL with LangWatch exporter
 * - Uses standalone adapters with pre-fetched data (no DB access)
 * - Communicates results back via parentPort messaging
 */

import { parentPort, workerData } from "node:worker_threads";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import ScenarioRunner from "@langwatch/scenario";
import { setupObservability } from "langwatch/observability/node";
import type {
  ScenarioWorkerData,
  ScenarioWorkerResult,
  WorkerMessage,
  LiteLLMParams,
} from "./types";
import {
  StandaloneHttpAgentAdapter,
  StandalonePromptConfigAdapter,
} from "./standalone-adapters";

if (!parentPort) {
  throw new Error("This script must be run as a worker thread");
}

const port = parentPort;

/**
 * Send a message to the parent thread.
 */
function sendMessage(message: WorkerMessage): void {
  port.postMessage(message);
}

/**
 * Send a log message to the parent.
 */
function log(
  level: "info" | "warn" | "error" | "debug",
  message: string,
): void {
  sendMessage({ type: "log", level, message });
}

/**
 * Creates a Vercel AI model from LiteLLM params.
 */
function createModelFromParams(
  litellmParams: LiteLLMParams,
  nlpServiceUrl: string,
) {
  const providerKey = litellmParams.model.split("/")[0];
  const headers = Object.fromEntries(
    Object.entries(litellmParams).map(([key, value]) => [
      `x-litellm-${key}`,
      value,
    ]),
  );

  const vercelProvider = createOpenAICompatible({
    name: providerKey ?? "unknown",
    apiKey: litellmParams.api_key,
    baseURL: `${nlpServiceUrl}/proxy/v1`,
    headers,
  });

  return vercelProvider(litellmParams.model);
}

/**
 * Main worker execution function.
 */
async function runScenario(): Promise<void> {
  const data = workerData as ScenarioWorkerData;

  log("info", `Starting scenario worker for scenario: ${data.scenarioId}`);

  let otelHandle: { shutdown: () => Promise<void> } | undefined;

  try {
    // 1. Set up isolated OpenTelemetry with LangWatch exporter
    log("debug", "Setting up isolated OpenTelemetry context");
    otelHandle = setupObservability({
      langwatch: {
        apiKey: data.langwatch.apiKey,
        endpoint: data.langwatch.endpoint,
        processorType: "simple", // Use simple processor for immediate export
      },
      serviceName: "langwatch-scenario-worker",
      attributes: {
        "scenario.id": data.scenarioId,
        "scenario.batch_run_id": data.batchRunId,
        "scenario.set_id": data.setId,
      },
      advanced: {
        // Force reinitialization since we're in an isolated worker
        UNSAFE_forceOpenTelemetryReinitialization: true,
      },
    });
    log("info", "OpenTelemetry setup completed");

    // 2. Create the target adapter from pre-fetched data
    log("debug", `Creating target adapter of type: ${data.targetAdapter.type}`);
    const targetAdapter =
      data.targetAdapter.type === "prompt"
        ? new StandalonePromptConfigAdapter(
            data.targetAdapter,
            data.targetModelLiteLLMParams ?? data.defaultModelLiteLLMParams,
            data.nlpServiceUrl,
          )
        : new StandaloneHttpAgentAdapter(data.targetAdapter);

    // 3. Create simulator and judge models from default LiteLLM params
    const simulatorModel = createModelFromParams(
      data.defaultModelLiteLLMParams,
      data.nlpServiceUrl,
    );
    const judgeModel = createModelFromParams(
      data.defaultModelLiteLLMParams,
      data.nlpServiceUrl,
    );

    // 4. Run the scenario
    log("info", `Running scenario: ${data.scenarioName}`);

    // Run in headless mode
    process.env.SCENARIO_HEADLESS = "true";

    const result = await ScenarioRunner.run(
      {
        id: data.scenarioId,
        name: data.scenarioName,
        description: data.scenarioSituation,
        setId: data.setId,
        agents: [
          targetAdapter,
          ScenarioRunner.userSimulatorAgent({ model: simulatorModel }),
          ScenarioRunner.judgeAgent({
            model: judgeModel,
            criteria: data.judgeCriteria,
          }),
        ],
        verbose: true,
      },
      {
        batchRunId: data.batchRunId,
        langwatch: {
          endpoint: data.langwatch.endpoint,
          apiKey: data.langwatch.apiKey,
        },
      },
    );

    log("info", `Scenario completed: success=${result.success}`);

    // 5. Send result back to parent
    const workerResult: ScenarioWorkerResult = {
      success: result.success,
      runId: result.runId,
      reasoning: result.reasoning,
      metCriteria: result.metCriteria,
      unmetCriteria: result.unmetCriteria,
    };

    sendMessage({ type: "result", data: workerResult });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    log("error", `Scenario execution failed: ${errorMessage}`);
    sendMessage({ type: "error", error: errorMessage, stack: errorStack });
  } finally {
    // 6. Shutdown OTEL to ensure all traces are flushed
    if (otelHandle) {
      log("debug", "Shutting down OpenTelemetry");
      await otelHandle.shutdown();
      log("debug", "OpenTelemetry shutdown completed");
    }
  }
}

// Start execution
void runScenario();
