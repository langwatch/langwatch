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

const DEFAULT_NLP_SERVICE_URL = "http://localhost:8080";

interface ExecuteInWorkerParams {
  projectId: string;
  scenarioId: string;
  target: SimulationTarget;
  setId: string;
  batchRunId: string;
}

/**
 * Dependencies for ScenarioWorkerManager.
 * Allows injection for testing.
 */
export interface ScenarioWorkerManagerDeps {
  scenarioService: ScenarioService;
  promptService: PromptService;
  agentRepository: AgentRepository;
  prisma: PrismaClient;
}

/**
 * Type guard for LiteLLMParams.
 * Validates the shape of params returned from prepareLitellmParams.
 */
function isLiteLLMParams(params: unknown): params is LiteLLMParams {
  return (
    typeof params === "object" &&
    params !== null &&
    "api_key" in params &&
    "model" in params &&
    typeof (params as LiteLLMParams).api_key === "string" &&
    typeof (params as LiteLLMParams).model === "string"
  );
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
  private readonly prisma: PrismaClient;

  constructor(deps: ScenarioWorkerManagerDeps) {
    this.scenarioService = deps.scenarioService;
    this.promptService = deps.promptService;
    this.agentRepository = deps.agentRepository;
    this.prisma = deps.prisma;
  }

  async execute(params: ExecuteInWorkerParams): Promise<ScenarioWorkerResult> {
    const { projectId, scenarioId, batchRunId } = params;

    logger.info(
      { scenarioId, projectId, batchRunId },
      "Starting scenario worker execution",
    );

    try {
      const workerData = await this.prepareWorkerData(params);
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

  private async prepareWorkerData(
    params: ExecuteInWorkerParams,
  ): Promise<ScenarioWorkerData> {
    const { projectId, scenarioId, target, setId, batchRunId } = params;

    const scenario = await this.scenarioService.getById({
      projectId,
      id: scenarioId,
    });

    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { apiKey: true, defaultModel: true },
    });

    if (!project?.apiKey) {
      throw new Error(`Project ${projectId} not found or has no API key`);
    }

    const defaultModel = project.defaultModel ?? DEFAULT_MODEL;
    const defaultModelLiteLLMParams = await this.prepareLiteLLMParams(
      projectId,
      defaultModel,
    );

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
      nlpServiceUrl: env.LANGWATCH_NLP_SERVICE ?? DEFAULT_NLP_SERVICE_URL,
    };
  }

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

    if (!isLiteLLMParams(litellmParams)) {
      throw new Error("Invalid LiteLLM params returned from prepareLitellmParams");
    }

    return litellmParams;
  }

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

    const targetModelLiteLLMParams = await this.prepareLiteLLMParams(
      projectId,
      prompt.model,
    );

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

  private spawnWorker(data: ScenarioWorkerData): Promise<ScenarioWorkerResult> {
    return new Promise((resolve) => {
      const workerPath = this.getWorkerPath();

      logger.debug(
        { workerPath, scenarioId: data.scenarioId },
        "Spawning worker",
      );

      const worker = new Worker(workerPath, {
        workerData: data,
        execArgv:
          process.env.NODE_ENV !== "production"
            ? ["--import", "tsx"]
            : undefined,
      });

      let hasResolved = false;

      const resolveOnce = (result: ScenarioWorkerResult) => {
        if (!hasResolved) {
          hasResolved = true;
          resolve(result);
        }
      };

      worker.on("message", (message: WorkerMessage) => {
        switch (message.type) {
          case "result":
            resolveOnce(message.data);
            break;
          case "error":
            resolveOnce({ success: false, error: message.error });
            break;
          case "log":
            logger[message.level](
              { workerId: worker.threadId, scenarioId: data.scenarioId },
              `[Worker] ${message.message}`,
            );
            break;
          default: {
            const _exhaustive: never = message;
            logger.warn(
              { message: _exhaustive, scenarioId: data.scenarioId },
              "Unknown worker message type",
            );
          }
        }
      });

      worker.on("error", (error) => {
        logger.error(
          { error, scenarioId: data.scenarioId },
          "Worker thread error",
        );
        resolveOnce({ success: false, error: error.message });
      });

      worker.on("exit", (code) => {
        if (code !== 0) {
          logger.error(
            { exitCode: code, scenarioId: data.scenarioId },
            "Worker exited with non-zero code",
          );
          resolveOnce({ success: false, error: `Worker exited with code ${code}` });
        } else {
          resolveOnce({ success: false, error: "Worker exited without sending result" });
        }
      });
    });
  }

  private getWorkerPath(): string {
    if (process.env.NODE_ENV === "production") {
      return path.join(__dirname, "scenario-worker.js");
    }
    return path.join(__dirname, "scenario-worker.ts");
  }

  private getLangWatchEndpoint(): string {
    return env.BASE_HOST ?? "https://app.langwatch.ai";
  }

  static create(
    prisma: PrismaClient,
    deps?: Partial<ScenarioWorkerManagerDeps>,
  ): ScenarioWorkerManager {
    return new ScenarioWorkerManager({
      scenarioService: deps?.scenarioService ?? ScenarioService.create(prisma),
      promptService: deps?.promptService ?? new PromptService(prisma),
      agentRepository: deps?.agentRepository ?? new AgentRepository(prisma),
      prisma,
    });
  }
}
