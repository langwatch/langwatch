/**
 * Factory for creating production orchestrator with real dependencies.
 */

import ScenarioRunner from "@langwatch/scenario";
import type { AgentAdapter } from "@langwatch/scenario";
import { env } from "~/env.mjs";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../api/routers/modelProviders";
import { AgentRepository, type TypedAgent } from "../../agents/agent.repository";
import { prisma } from "../../db";
import type { AgentData, AgentLookup } from "../adapters/http.adapter.factory";
import { PromptService } from "../../prompt-config/prompt.service";
import { HttpAdapterFactory } from "../adapters/http.adapter.factory";
import { PromptAdapterFactory } from "../adapters/prompt.adapter.factory";
import { TargetAdapterRegistry } from "../adapters/adapter.registry";
import { ScenarioService } from "../scenario.service";
import { createScenarioTracer } from "./instrumentation";
import { createModelFromParams } from "./model.factory";
import { ScenarioExecutionOrchestrator } from "./orchestrator";
import type {
  AdapterFactory,
  ModelParamsProvider,
  OrchestratorDependencies,
  ProjectRepository,
  ScenarioExecutor,
  ScenarioRepository,
  TracerFactory,
} from "./orchestrator.types";
import type { LiteLLMParams, ScenarioConfig, ScenarioExecutionResult } from "./types";

/** Creates scenario repository using ScenarioService */
function createScenarioRepository(): ScenarioRepository {
  const service = ScenarioService.create(prisma);
  return {
    async getById({ projectId, id }) {
      const scenario = await service.getById({ projectId, id });
      if (!scenario) return null;
      return {
        id: scenario.id,
        name: scenario.name,
        situation: scenario.situation,
        criteria: scenario.criteria,
      };
    },
  };
}

/** Creates project repository using Prisma */
function createProjectRepository(): ProjectRepository {
  return {
    async getProject(projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { apiKey: true, defaultModel: true },
      });
      if (!project?.apiKey) return null;
      return {
        apiKey: project.apiKey,
        defaultModel: project.defaultModel,
      };
    },
  };
}

/** Creates model params provider using existing functions */
function createModelParamsProvider(): ModelParamsProvider {
  return {
    async prepare(projectId, model) {
      try {
        const providers = await getProjectModelProviders(projectId);
        const providerKey = model.split("/")[0];
        if (!providerKey) return null;

        const provider = providers[providerKey];
        if (!provider?.enabled) return null;

        const params = await prepareLitellmParams({ model, modelProvider: provider, projectId });
        if (!params.api_key || !params.model) return null;

        return params as LiteLLMParams;
      } catch {
        return null;
      }
    },
  };
}

/** Adapts AgentRepository to AgentLookup interface */
function createAgentLookup(repo: AgentRepository): AgentLookup {
  return {
    async findById(params): Promise<AgentData | null> {
      const agent = await repo.findById(params);
      if (!agent) return null;

      // Only HTTP agents have the required config shape
      if (agent.type !== "http") {
        return { id: agent.id, type: agent.type, config: {} as AgentData["config"] };
      }

      // TypedAgent with type=http has HttpComponentConfig
      const config = agent.config as {
        url: string;
        method: string;
        headers?: Array<{ key: string; value: string }>;
        auth?: { type: "none" | "bearer" | "api_key" | "basic"; token?: string; header?: string; value?: string };
        bodyTemplate?: string;
        outputPath?: string;
      };
      return {
        id: agent.id,
        type: agent.type,
        config: {
          url: config.url,
          method: config.method,
          headers: config.headers,
          auth: config.auth,
          bodyTemplate: config.bodyTemplate,
          outputPath: config.outputPath,
        },
      };
    },
  };
}

/** Creates adapter factory using the registry pattern */
function createAdapterFactory(): AdapterFactory {
  const modelParamsProvider = createModelParamsProvider();

  const promptFactory = new PromptAdapterFactory(
    new PromptService(prisma),
    modelParamsProvider,
  );

  const agentLookup = createAgentLookup(new AgentRepository(prisma));
  const httpFactory = new HttpAdapterFactory(agentLookup);

  return new TargetAdapterRegistry([promptFactory, httpFactory]);
}

/** Creates tracer factory */
function createTracerFactory(): TracerFactory {
  return {
    create: createScenarioTracer,
  };
}

/** Creates scenario executor using the SDK */
function createScenarioExecutor(): ScenarioExecutor {
  return {
    async run(
      scenario: ScenarioConfig,
      adapter: AgentAdapter,
      modelParams: LiteLLMParams,
      nlpServiceUrl: string,
      batchRunId: string,
    ): Promise<ScenarioExecutionResult> {
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
        { batchRunId },
      );

      return {
        success: result.success,
        runId: result.runId,
        reasoning: result.reasoning,
      };
    },
  };
}

/** Creates orchestrator with all production dependencies */
export function createOrchestrator(): ScenarioExecutionOrchestrator {
  const deps: OrchestratorDependencies = {
    scenarioRepository: createScenarioRepository(),
    projectRepository: createProjectRepository(),
    modelParamsProvider: createModelParamsProvider(),
    adapterFactory: createAdapterFactory(),
    tracerFactory: createTracerFactory(),
    scenarioExecutor: createScenarioExecutor(),
    nlpServiceUrl: env.LANGWATCH_NLP_SERVICE ?? "http://localhost:8080",
    telemetryEndpoint: env.BASE_HOST,
  };

  return new ScenarioExecutionOrchestrator(deps);
}
