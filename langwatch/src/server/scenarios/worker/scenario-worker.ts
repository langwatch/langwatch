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
import ScenarioRunner from "@langwatch/scenario";
import { setupObservability } from "langwatch/observability/node";
import { createModelFromParams } from "./model-factory";
import {
  StandaloneHttpAgentAdapter,
  StandalonePromptConfigAdapter,
} from "./standalone-adapters";
import type {
  ScenarioWorkerData,
  ScenarioWorkerResult,
  WorkerMessage,
} from "./types";

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

async function runScenario(): Promise<void> {
  const data = workerData as ScenarioWorkerData;

  log("info", `Starting scenario worker for scenario: ${data.scenarioId}`);

  let otelHandle: { shutdown: () => Promise<void> } | undefined;

  try {
    otelHandle = setupIsolatedOtel(data);
    const targetAdapter = createTargetAdapter(data);
    const { simulatorModel, judgeModel } = createAgentModels(data);

    log("info", `Running scenario: ${data.scenarioName}`);
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
    if (otelHandle) {
      log("debug", "Shutting down OpenTelemetry");
      await otelHandle.shutdown();
    }
  }
}

function setupIsolatedOtel(data: ScenarioWorkerData) {
  log("debug", "Setting up isolated OpenTelemetry context");
  const handle = setupObservability({
    langwatch: {
      apiKey: data.langwatch.apiKey,
      endpoint: data.langwatch.endpoint,
      processorType: "simple",
    },
    serviceName: "langwatch-scenario-worker",
    attributes: {
      "scenario.id": data.scenarioId,
      "scenario.batch_run_id": data.batchRunId,
      "scenario.set_id": data.setId,
    },
    advanced: {
      UNSAFE_forceOpenTelemetryReinitialization: true,
    },
  });
  log("info", "OpenTelemetry setup completed");
  return handle;
}

function createTargetAdapter(data: ScenarioWorkerData) {
  log("debug", `Creating target adapter of type: ${data.targetAdapter.type}`);
  return data.targetAdapter.type === "prompt"
    ? new StandalonePromptConfigAdapter(
        data.targetAdapter,
        data.targetModelLiteLLMParams ?? data.defaultModelLiteLLMParams,
        data.nlpServiceUrl,
      )
    : new StandaloneHttpAgentAdapter(data.targetAdapter);
}

function createAgentModels(data: ScenarioWorkerData) {
  return {
    simulatorModel: createModelFromParams(
      data.defaultModelLiteLLMParams,
      data.nlpServiceUrl,
    ),
    judgeModel: createModelFromParams(
      data.defaultModelLiteLLMParams,
      data.nlpServiceUrl,
    ),
  };
}

// Start execution
void runScenario();
