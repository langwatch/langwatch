/**
 * Scenario job processor for BullMQ.
 *
 * Processes scenario execution jobs in an isolated context with
 * scenario-specific OTEL tracing.
 *
 * @see https://github.com/langwatch/langwatch/issues/1088
 */

import ScenarioRunner from "@langwatch/scenario";
import type { Job, Worker } from "bullmq";
import { Worker as BullMQWorker } from "bullmq";
import { env } from "~/env.mjs";
import { createLogger } from "~/utils/logger";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../api/routers/modelProviders";
import { AgentRepository } from "../agents/agent.repository";
import { prisma } from "../db";
import { PromptService } from "../prompt-config/prompt.service";
import { connection } from "../redis";
import {
  SerializedHttpAgentAdapter,
  SerializedPromptConfigAdapter,
} from "./execution/serialized.adapters";
import type { HttpAgentData, LiteLLMParams, PromptConfigData } from "./execution/types";
import { createScenarioTracer, type ScenarioTracerHandle } from "./execution/instrumentation";
import type { ScenarioJob, ScenarioJobResult } from "./scenario.queue";
import { SCENARIO_QUEUE_NAME } from "./scenario.queue";
import { ScenarioService } from "./scenario.service";

const logger = createLogger("langwatch:scenarios:processor");

/**
 * Process a scenario job.
 *
 * This is the main entry point for scenario execution. It:
 * 1. Fetches scenario and target configuration
 * 2. Sets up isolated OTEL tracing
 * 3. Runs the scenario using the SDK
 * 4. Returns results
 */
export async function processScenarioJob(
  job: Job<ScenarioJob, ScenarioJobResult, string>,
): Promise<ScenarioJobResult> {
  const { projectId, scenarioId, target, setId, batchRunId } = job.data;

  logger.info(
    { jobId: job.id, scenarioId, projectId, batchRunId },
    "Processing scenario job",
  );

  let tracerHandle: ScenarioTracerHandle | undefined;

  try {
    // 1. Fetch scenario
    const scenarioService = ScenarioService.create(prisma);
    const scenario = await scenarioService.getById({ projectId, id: scenarioId });

    if (!scenario) {
      logger.error({ scenarioId, projectId }, "Scenario not found");
      return { success: false, error: `Scenario ${scenarioId} not found` };
    }

    // 2. Fetch project for API key and default model
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true, defaultModel: true },
    });

    if (!project?.apiKey) {
      logger.error({ projectId }, "Project not found or has no API key");
      return {
        success: false,
        error: `Project ${projectId} not found or has no API key`,
      };
    }

    // 3. Prepare LiteLLM params for the default model (used by simulator and judge)
    const defaultModel = project.defaultModel ?? "openai/gpt-4o-mini";
    const defaultLiteLLMParams = await prepareLiteLLMParamsForModel(
      projectId,
      defaultModel,
    );

    if (!defaultLiteLLMParams) {
      return {
        success: false,
        error: `Failed to prepare model params for ${defaultModel}`,
      };
    }

    // 4. Create target adapter
    const adapterResult = await createTargetAdapter(
      projectId,
      target,
      defaultLiteLLMParams,
    );

    if (!adapterResult.success) {
      return { success: false, error: adapterResult.error };
    }

    // 5. Set up isolated OTEL tracing
    tracerHandle = createScenarioTracer({
      endpoint: env.BASE_HOST,
      apiKey: project.apiKey,
      scenarioId,
      batchRunId,
      projectId,
    });

    // 6. Run the scenario
    logger.info(
      { scenarioId, batchRunId, targetType: target.type },
      "Running scenario with SDK",
    );

    const nlpServiceUrl = env.LANGWATCH_NLP_SERVICE ?? "http://localhost:8080";

    const result = await ScenarioRunner.run(
      {
        id: scenario.id,
        name: scenario.name,
        description: scenario.situation,
        agents: [
          adapterResult.adapter,
          ScenarioRunner.userSimulatorAgent({
            model: createModelFromParams(defaultLiteLLMParams, nlpServiceUrl),
          }),
          ScenarioRunner.judgeAgent({
            criteria: scenario.criteria,
            model: createModelFromParams(defaultLiteLLMParams, nlpServiceUrl),
          }),
        ],
      },
      {
        batchRunId,
      },
    );

    logger.info(
      { scenarioId, batchRunId, success: result.success },
      "Scenario execution completed",
    );

    return {
      success: result.success,
      runId: result.runId,
      reasoning: result.reasoning,
    };
  } catch (error) {
    logger.error(
      { error, scenarioId, projectId, batchRunId },
      "Scenario execution failed",
    );

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    // Always shutdown tracer to flush spans
    if (tracerHandle) {
      await tracerHandle.shutdown();
    }
  }
}

/**
 * Create the target adapter based on target type.
 */
async function createTargetAdapter(
  projectId: string,
  target: ScenarioJob["target"],
  defaultLiteLLMParams: LiteLLMParams,
): Promise<
  | { success: true; adapter: SerializedPromptConfigAdapter | SerializedHttpAgentAdapter }
  | { success: false; error: string }
> {
  const nlpServiceUrl = env.LANGWATCH_NLP_SERVICE ?? "http://localhost:8080";

  if (target.type === "prompt") {
    const promptService = new PromptService(prisma);
    const prompt = await promptService.getPromptByIdOrHandle({
      idOrHandle: target.referenceId,
      projectId,
    });

    if (!prompt) {
      return { success: false, error: `Prompt ${target.referenceId} not found` };
    }

    // Prepare LiteLLM params for the prompt's model
    const promptModel = prompt.model ?? "openai/gpt-4o-mini";
    const promptLiteLLMParams = await prepareLiteLLMParamsForModel(
      projectId,
      promptModel,
    );

    if (!promptLiteLLMParams) {
      return {
        success: false,
        error: `Failed to prepare model params for ${promptModel}`,
      };
    }

    const config: PromptConfigData = {
      type: "prompt",
      promptId: prompt.id,
      systemPrompt: prompt.prompt,
      messages: prompt.messages ?? [],
      model: promptModel,
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    };

    return {
      success: true,
      adapter: new SerializedPromptConfigAdapter(
        config,
        promptLiteLLMParams,
        nlpServiceUrl,
      ),
    };
  }

  if (target.type === "http") {
    const agentRepository = new AgentRepository(prisma);
    const agent = await agentRepository.findById({
      id: target.referenceId,
      projectId,
    });

    if (!agent) {
      return {
        success: false,
        error: `HTTP agent ${target.referenceId} not found`,
      };
    }

    if (agent.type !== "http") {
      return {
        success: false,
        error: `Agent ${target.referenceId} is not an HTTP agent (type: ${agent.type})`,
      };
    }

    const httpConfig = agent.config as {
      url: string;
      method: string;
      headers?: Array<{ key: string; value: string }>;
      auth?: { type: string; token?: string; header?: string; value?: string };
      bodyTemplate?: string;
      outputPath?: string;
    };

    const config: HttpAgentData = {
      type: "http",
      agentId: agent.id,
      url: httpConfig.url,
      method: httpConfig.method,
      headers: httpConfig.headers ?? [],
      auth: httpConfig.auth,
      bodyTemplate: httpConfig.bodyTemplate,
      outputPath: httpConfig.outputPath,
    };

    return {
      success: true,
      adapter: new SerializedHttpAgentAdapter(config),
    };
  }

  return { success: false, error: `Unknown target type: ${target.type}` };
}

/**
 * Prepare LiteLLM params for a model.
 */
async function prepareLiteLLMParamsForModel(
  projectId: string,
  model: string,
): Promise<LiteLLMParams | null> {
  try {
    const modelProviders = await getProjectModelProviders(projectId);
    const providerKey = model.split("/")[0];

    if (!providerKey) {
      logger.error({ model }, "Invalid model format - no provider");
      return null;
    }

    const provider = modelProviders[providerKey];
    if (!provider?.enabled) {
      logger.error({ providerKey, projectId }, "Model provider not enabled");
      return null;
    }

    const params = await prepareLitellmParams({
      model,
      modelProvider: provider,
      projectId,
    });

    if (!params.api_key || !params.model) {
      logger.error({ model }, "Invalid LiteLLM params - missing required fields");
      return null;
    }

    return params as LiteLLMParams;
  } catch (error) {
    logger.error({ error, model, projectId }, "Failed to prepare LiteLLM params");
    return null;
  }
}

/**
 * Create a Vercel AI model from LiteLLM params.
 * Re-exported from model.factory for convenience.
 */
import { createModelFromParams } from "./execution/model.factory";

/**
 * Start the scenario processor (BullMQ worker).
 *
 * This should be called from a separate entry point (scenario-worker.ts)
 * that has its own OTEL instrumentation.
 */
export function startScenarioProcessor(): Worker<
  ScenarioJob,
  ScenarioJobResult,
  string
> | undefined {
  if (!connection) {
    logger.info("No Redis connection, skipping scenario processor");
    return undefined;
  }

  const worker = new BullMQWorker<ScenarioJob, ScenarioJobResult, string>(
    SCENARIO_QUEUE_NAME,
    async (job) => {
      return await processScenarioJob(job);
    },
    {
      connection,
      concurrency: 3, // Process up to 3 scenarios concurrently
      stalledInterval: 10 * 60 * 1000, // 10 minutes
    },
  );

  worker.on("ready", () => {
    logger.info("Scenario processor ready, waiting for jobs");
  });

  worker.on("failed", (job, error) => {
    logger.error(
      { jobId: job?.id, error, data: job?.data },
      "Scenario job failed",
    );
  });

  worker.on("completed", (job) => {
    logger.info(
      { jobId: job.id, scenarioId: job.data.scenarioId },
      "Scenario job completed",
    );
  });

  logger.info("Scenario processor started");
  return worker;
}
