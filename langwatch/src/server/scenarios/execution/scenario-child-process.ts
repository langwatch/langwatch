/**
 * Child process entry point for isolated scenario execution.
 *
 * OTEL isolation is achieved by:
 * 1. Parent sets LANGWATCH_API_KEY and LANGWATCH_ENDPOINT env vars
 * 2. This process imports @langwatch/scenario which calls setupObservability()
 *    at module load time, reading from those env vars
 * 3. Each child process gets its own OTEL TracerProvider
 *
 * Communication:
 * - Input: JSON job data via stdin
 * - Output: JSON result via stdout
 *
 * @see specs/scenarios/simulation-runner.feature (Worker-Based Execution scenarios)
 */

import * as ScenarioRunner from "@langwatch/scenario";
import type {
  ChildProcessJobData,
  ScenarioExecutionResult,
} from "./types";
import { createModelFromParams } from "./model.factory";
import {
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
} from "./serialized.adapters";

async function main(): Promise<void> {
  const jobData = await readJobDataFromStdin();
  const result = await executeScenario(jobData);
  writeResultToStdout(result);
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

async function executeScenario(
  jobData: ChildProcessJobData,
): Promise<ScenarioExecutionResult> {
  const { context, scenario, adapterData, modelParams, nlpServiceUrl } = jobData;

  try {
    const adapter = createAdapter(adapterData, modelParams, nlpServiceUrl);
    const model = createModelFromParams(modelParams, nlpServiceUrl);

    const result = await ScenarioRunner.run(
      {
        id: scenario.id,
        name: scenario.name,
        description: scenario.situation,
        agents: [
          adapter,
          ScenarioRunner.userSimulatorAgent({ model }),
          ScenarioRunner.judgeAgent({ criteria: scenario.criteria, model }),
        ],
      },
      {
        batchRunId: context.batchRunId,
        langwatch: {
          endpoint: process.env.LANGWATCH_ENDPOINT!,
          apiKey: process.env.LANGWATCH_API_KEY!,
        },
      },
    );

    return {
      success: result.success,
      runId: result.runId,
      reasoning: result.reasoning,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function createAdapter(
  adapterData: ChildProcessJobData["adapterData"],
  modelParams: ChildProcessJobData["modelParams"],
  nlpServiceUrl: string,
) {
  if (adapterData.type === "prompt") {
    return new SerializedPromptConfigAdapter(
      adapterData,
      modelParams,
      nlpServiceUrl,
    );
  }
  return new SerializedHttpAgentAdapter(adapterData);
}

function writeResultToStdout(result: ScenarioExecutionResult): void {
  process.stdout.write(JSON.stringify(result));
}

main().catch((error) => {
  const errorResult: ScenarioExecutionResult = {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
  writeResultToStdout(errorResult);
  process.exit(1);
});
