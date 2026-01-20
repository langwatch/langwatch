/**
 * Scenario Worker Manager
 *
 * Handles the lifecycle of scenario worker threads including:
 * - Pre-fetching all required data from the database
 * - Spawning worker threads with serialized configuration
 * - Handling worker communication and results
 */

import path from "node:path";
import { Worker } from "node:worker_threads";
import type { PrismaClient } from "@prisma/client";
import type { HttpComponentConfig } from "~/optimization_studio/types/dsl";
import { env } from "~/env.mjs";
import { DEFAULT_MODEL } from "~/utils/constants";
import { createLogger } from "~/utils/logger";
import type { SimulationTarget } from "../../api/routers/scenarios";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../api/routers/modelProviders";
import { AgentRepository } from "../../agents/agent.repository";
import { PromptService } from "../../prompt-config/prompt.service";
import { ScenarioService } from "../scenario.service";
import type {
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
  ScenarioWorkerData,
  ScenarioWorkerResult,
  TargetAdapterData,
  WorkerMessage,
} from "./types";

const logger = createLogger("ScenarioWorkerManager");

interface ExecuteInWorkerParams {
  projectId: string;
  scenarioId: string;
  target: SimulationTarget;
  setId: string;
  batchRunId: string;
}

/**
 * Manager for scenario worker threads with isolated OTEL context.
 *
 * Pre-fetches all required data from the database and passes serialized
 * configuration to the worker, avoiding the need for database access
 * in the worker thread.
 */
export class ScenarioWorkerManager {
  private readonly scenarioService: ScenarioService;
  private readonly promptService: PromptService;
  private readonly agentRepository: AgentRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.scenarioService = ScenarioService.create(prisma);
    this.promptService = new PromptService(prisma);
    this.agentRepository = new AgentRepository(prisma);
  }

  /**
   * Execute a scenario in an isolated worker thread with its own OTEL context.
   *
   * This method:
   * 1. Pre-fetches all required data from the database
   * 2. Spawns a worker thread with serialized configuration
   * 3. Waits for the worker to complete and returns the result
   */
  async execute(params: ExecuteInWorkerParams): Promise<ScenarioWorkerResult> {
    const { projectId, scenarioId, target, setId, batchRunId } = params;

    logger.info(
      { scenarioId, projectId, batchRunId },
      "Starting scenario worker execution",
    );

    try {
      // 1. Pre-fetch all required data
      const workerData = await this.prepareWorkerData({
        projectId,
        scenarioId,
        target,
        setId,
        batchRunId,
      });

      // 2. Spawn worker and wait for result
      const result = await this.spawnWorker(workerData);

      logger.info(
        { scenarioId, projectId, success: result.success },
        "Scenario worker execution completed",
      );

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { error, scenarioId, projectId },
        "Scenario worker execution failed",
      );

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Pre-fetches all data required for scenario execution and prepares
   * the serializable worker data structure.
   */
  private async prepareWorkerData(
    params: ExecuteInWorkerParams,
  ): Promise<ScenarioWorkerData> {
    const { projectId, scenarioId, target, setId, batchRunId } = params;

    // Fetch scenario
    const scenario = await this.scenarioService.getById({
      projectId,
      id: scenarioId,
    });

    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }

    // Fetch project config
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true, defaultModel: true },
    });

    if (!project?.apiKey) {
      throw new Error(`Project ${projectId} not found or has no API key`);
    }

    // Get default model for simulator/judge
    const defaultModel = project.defaultModel ?? DEFAULT_MODEL;

    // Prepare LiteLLM params for the default model
    const defaultModelLiteLLMParams = await this.prepareLiteLLMParams(
      projectId,
      defaultModel,
    );

    // Prepare target adapter data
    const { targetAdapter, targetModelLiteLLMParams } =
      await this.prepareTargetAdapterData(target, projectId);

    return {
      scenarioId,
      scenarioName: scenario.name,
      scenarioSituation: scenario.situation,
      setId,
      batchRunId,
      targetAdapter,
      judgeCriteria: scenario.criteria,
      defaultModel,
      defaultModelLiteLLMParams,
      targetModelLiteLLMParams,
      langwatch: {
        endpoint: this.getLangWatchEndpoint(),
        apiKey: project.apiKey,
      },
      nlpServiceUrl: env.LANGWATCH_NLP_SERVICE ?? "http://localhost:8080",
    };
  }

  /**
   * Prepares LiteLLM parameters for a given model.
   */
  private async prepareLiteLLMParams(
    projectId: string,
    model: string,
  ): Promise<LiteLLMParams> {
    const providerKey = model.split("/")[0] as string;
    const modelProviders = await getProjectModelProviders(projectId);
    const modelProvider = modelProviders[providerKey];

    if (!modelProvider || !modelProvider.enabled) {
      throw new Error(
        `Model provider ${providerKey} not configured or disabled for project`,
      );
    }

    const litellmParams = await prepareLitellmParams({
      model,
      modelProvider,
      projectId,
    });

    return litellmParams as LiteLLMParams;
  }

  /**
   * Prepares the target adapter data based on target type.
   */
  private async prepareTargetAdapterData(
    target: SimulationTarget,
    projectId: string,
  ): Promise<{
    targetAdapter: TargetAdapterData;
    targetModelLiteLLMParams?: LiteLLMParams;
  }> {
    switch (target.type) {
      case "prompt":
        return this.preparePromptAdapterData(target.referenceId, projectId);
      case "http":
        return this.prepareHttpAdapterData(target.referenceId, projectId);
      default: {
        const _exhaustive: never = target.type;
        throw new Error(`Unknown target type: ${_exhaustive}`);
      }
    }
  }

  /**
   * Prepares data for prompt-based target adapter.
   */
  private async preparePromptAdapterData(
    promptId: string,
    projectId: string,
  ): Promise<{
    targetAdapter: PromptConfigData;
    targetModelLiteLLMParams: LiteLLMParams;
  }> {
    const prompt = await this.promptService.getPromptByIdOrHandle({
      idOrHandle: promptId,
      projectId,
    });

    if (!prompt) {
      throw new Error(`Prompt ${promptId} not found`);
    }

    // Prepare LiteLLM params for the prompt's model
    const targetModelLiteLLMParams = await this.prepareLiteLLMParams(
      projectId,
      prompt.model,
    );

    // Build adapter data
    const promptMessages = prompt.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));

    const targetAdapter: PromptConfigData = {
      type: "prompt",
      promptId,
      systemPrompt: prompt.prompt,
      messages: promptMessages,
      model: prompt.model,
      ...(prompt.temperature != null && { temperature: prompt.temperature }),
      ...(prompt.maxTokens != null && { maxTokens: prompt.maxTokens }),
    };

    return { targetAdapter, targetModelLiteLLMParams };
  }

  /**
   * Prepares data for HTTP-based target adapter.
   */
  private async prepareHttpAdapterData(
    agentId: string,
    projectId: string,
  ): Promise<{
    targetAdapter: HttpAgentData;
    targetModelLiteLLMParams?: undefined;
  }> {
    const agent = await this.agentRepository.findById({
      id: agentId,
      projectId,
    });

    if (!agent) {
      throw new Error(`HTTP agent ${agentId} not found`);
    }

    if (agent.type !== "http") {
      throw new Error(
        `Agent ${agentId} is not an HTTP agent (type: ${agent.type})`,
      );
    }

    const config = agent.config as HttpComponentConfig;

    const targetAdapter: HttpAgentData = {
      type: "http",
      agentId,
      url: config.url,
      method: config.method,
      headers: config.headers ?? [],
      auth: config.auth,
      bodyTemplate: config.bodyTemplate,
      outputPath: config.outputPath,
    };

    return { targetAdapter };
  }

  /**
   * Spawns a worker thread and returns a promise that resolves with the result.
   */
  private spawnWorker(data: ScenarioWorkerData): Promise<ScenarioWorkerResult> {
    return new Promise((resolve, reject) => {
      // Resolve the worker script path
      // In development, we use the TypeScript file via ts-node/tsx
      // In production, we use the compiled JavaScript file
      const workerPath = this.getWorkerPath();

      logger.debug({ workerPath, scenarioId: data.scenarioId }, "Spawning worker");

      const worker = new Worker(workerPath, {
        workerData: data,
        // Enable TypeScript support in development
        execArgv: process.env.NODE_ENV !== "production"
          ? ["--import", "tsx"]
          : undefined,
      });

      let hasResolved = false;

      worker.on("message", (message: WorkerMessage) => {
        switch (message.type) {
          case "result":
            hasResolved = true;
            resolve(message.data);
            break;
          case "error":
            hasResolved = true;
            resolve({
              success: false,
              error: message.error,
            });
            break;
          case "log":
            // Forward worker logs
            logger[message.level](
              { workerId: worker.threadId, scenarioId: data.scenarioId },
              `[Worker] ${message.message}`,
            );
            break;
        }
      });

      worker.on("error", (error) => {
        if (!hasResolved) {
          hasResolved = true;
          logger.error(
            { error, scenarioId: data.scenarioId },
            "Worker thread error",
          );
          resolve({
            success: false,
            error: error.message,
          });
        }
      });

      worker.on("exit", (code) => {
        if (!hasResolved) {
          hasResolved = true;
          if (code !== 0) {
            logger.error(
              { exitCode: code, scenarioId: data.scenarioId },
              "Worker exited with non-zero code",
            );
            resolve({
              success: false,
              error: `Worker exited with code ${code}`,
            });
          } else {
            // Worker exited cleanly but never sent a result
            resolve({
              success: false,
              error: "Worker exited without sending result",
            });
          }
        }
      });
    });
  }

  /**
   * Gets the path to the worker script.
   */
  private getWorkerPath(): string {
    // In production, use the compiled JS file
    if (process.env.NODE_ENV === "production") {
      return path.join(__dirname, "scenario-worker.js");
    }

    // In development, use the TypeScript file
    return path.join(__dirname, "scenario-worker.ts");
  }

  private getLangWatchEndpoint(): string {
    return env.BASE_HOST ?? "https://app.langwatch.ai";
  }

  static create(prisma: PrismaClient): ScenarioWorkerManager {
    return new ScenarioWorkerManager(prisma);
  }
}
