/**
 * Pre-fetches all data needed for child process scenario execution.
 *
 * Gathers scenario config, project info, model params, and adapter data
 * so the child process can run without DB access.
 *
 * Follows Dependency Inversion Principle (DIP):
 * - Core logic depends on abstractions (DataPrefetcherDependencies interface)
 * - Factory function wires up concrete implementations for production
 * - Tests can inject mocks without vi.mock
 */

import { env } from "~/env.mjs";
import { DEFAULT_MODEL } from "~/utils/constants";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../api/routers/modelProviders";
import { AgentRepository, type TypedAgent } from "../../agents/agent.repository";
import { prisma } from "../../db";
import { PromptService, type VersionedPrompt } from "../../prompt-config/prompt.service";
import { ScenarioService } from "../scenario.service";
import type {
  ChildProcessJobData,
  ExecutionContext,
  HttpAgentData,
  LiteLLMParams,
  PromptConfigData,
  ScenarioConfig,
  TargetAdapterData,
  TargetConfig,
} from "./types";

// ============================================================================
// Dependency Interfaces (Dependency Inversion Principle)
// ============================================================================

/** Minimal interface for scenario lookup - uses only what prefetcher needs */
export interface ScenarioFetcher {
  getById(params: { projectId: string; id: string }): Promise<{
    id: string;
    name: string;
    situation: string;
    criteria: string[];
    labels: string[];
  } | null>;
}

/** Minimal interface for prompt lookup - uses only what prefetcher needs */
export interface PromptFetcher {
  getPromptByIdOrHandle(params: {
    projectId: string;
    idOrHandle: string;
  }): Promise<VersionedPrompt | null>;
}

/** Minimal interface for agent lookup - uses only what prefetcher needs */
export interface AgentFetcher {
  findById(params: { projectId: string; id: string }): Promise<TypedAgent | null>;
}

/** Minimal interface for project lookup */
export interface ProjectFetcher {
  findUnique(projectId: string): Promise<{
    apiKey: string | null;
    defaultModel: string | null;
  } | null>;
}

/** Minimal interface for model params preparation */
export interface ModelParamsProvider {
  prepare(projectId: string, model: string): Promise<LiteLLMParams | null>;
}

/** All dependencies required by prefetchScenarioData */
export interface DataPrefetcherDependencies {
  scenarioFetcher: ScenarioFetcher;
  promptFetcher: PromptFetcher;
  agentFetcher: AgentFetcher;
  projectFetcher: ProjectFetcher;
  modelParamsProvider: ModelParamsProvider;
}

// ============================================================================
// Result Types
// ============================================================================

export type PrefetchResult =
  | {
      success: true;
      data: ChildProcessJobData;
      telemetry: { endpoint: string; apiKey: string };
    }
  | {
      success: false;
      error: string;
    };

// ============================================================================
// Core Logic (depends on abstractions)
// ============================================================================

/**
 * Pre-fetch all data needed for scenario execution.
 *
 * @param context - Execution context with project/scenario IDs
 * @param target - Target configuration (prompt or http)
 * @param deps - Injected dependencies for data fetching
 */
export async function prefetchScenarioData(
  context: ExecutionContext,
  target: TargetConfig,
  deps: DataPrefetcherDependencies,
): Promise<PrefetchResult> {
  const scenario = await fetchScenario(
    context.projectId,
    context.scenarioId,
    deps.scenarioFetcher,
  );
  if (!scenario) {
    return { success: false, error: `Scenario ${context.scenarioId} not found` };
  }

  const projectResult = await fetchProject(context.projectId, deps.projectFetcher);
  if (!projectResult.success) {
    return { success: false, error: projectResult.error };
  }
  const project = projectResult.data;

  const adapterData = await fetchAdapterData(context.projectId, target, deps);
  if (!adapterData) {
    return {
      success: false,
      error: `${target.type === "prompt" ? "Prompt" : "HTTP agent"} ${target.referenceId} not found`,
    };
  }

  // When target is a prompt, use the prompt's configured model for fetching model params
  const modelForParams =
    adapterData.type === "prompt" && adapterData.model
      ? adapterData.model
      : project.defaultModel;
  const modelParams = await deps.modelParamsProvider.prepare(
    context.projectId,
    modelForParams,
  );
  if (!modelParams) {
    return { success: false, error: "Failed to prepare model params" };
  }

  return {
    success: true,
    data: {
      context,
      scenario,
      adapterData,
      modelParams,
      nlpServiceUrl: env.LANGWATCH_NLP_SERVICE ?? "http://localhost:8080",
    },
    telemetry: {
      endpoint: env.BASE_HOST ?? "https://app.langwatch.ai",
      apiKey: project.apiKey,
    },
  };
}

// ============================================================================
// Internal Fetch Functions
// ============================================================================

async function fetchScenario(
  projectId: string,
  scenarioId: string,
  fetcher: ScenarioFetcher,
): Promise<ScenarioConfig | null> {
  const scenario = await fetcher.getById({ projectId, id: scenarioId });
  if (!scenario) return null;
  return {
    id: scenario.id,
    name: scenario.name,
    situation: scenario.situation,
    criteria: scenario.criteria,
    labels: scenario.labels,
  };
}

type FetchProjectResult =
  | { success: true; data: { apiKey: string; defaultModel: string } }
  | { success: false; error: string };

async function fetchProject(
  projectId: string,
  fetcher: ProjectFetcher,
): Promise<FetchProjectResult> {
  const project = await fetcher.findUnique(projectId);
  if (!project?.apiKey) {
    return { success: false, error: `Project ${projectId} not found` };
  }
  // Fall back to DEFAULT_MODEL like the rest of the app does
  return {
    success: true,
    data: {
      apiKey: project.apiKey,
      defaultModel: project.defaultModel ?? DEFAULT_MODEL,
    },
  };
}

async function fetchAdapterData(
  projectId: string,
  target: TargetConfig,
  deps: DataPrefetcherDependencies,
): Promise<TargetAdapterData | null> {
  if (target.type === "prompt") {
    return fetchPromptConfigData(projectId, target.referenceId, deps.promptFetcher);
  }
  return fetchHttpAgentData(projectId, target.referenceId, deps.agentFetcher);
}

async function fetchPromptConfigData(
  projectId: string,
  promptId: string,
  fetcher: PromptFetcher,
): Promise<PromptConfigData | null> {
  const prompt = await fetcher.getPromptByIdOrHandle({
    projectId,
    idOrHandle: promptId,
  });
  if (!prompt) return null;

  return {
    type: "prompt",
    promptId: prompt.id,
    systemPrompt: prompt.prompt ?? "",
    messages: (prompt.messages ?? []).filter(
      (m): m is { role: "user" | "assistant"; content: string } =>
        m.role === "user" || m.role === "assistant",
    ),
    model: prompt.model ?? undefined,
    temperature: prompt.temperature ?? undefined,
    maxTokens: prompt.maxTokens ?? undefined,
  };
}

async function fetchHttpAgentData(
  projectId: string,
  agentId: string,
  fetcher: AgentFetcher,
): Promise<HttpAgentData | null> {
  const agent = await fetcher.findById({ projectId, id: agentId });
  if (!agent || agent.type !== "http") return null;

  const config = agent.config as {
    url: string;
    method: string;
    headers?: Array<{ key: string; value: string }>;
    auth?: {
      type: "none" | "bearer" | "api_key" | "basic";
      token?: string;
      header?: string;
      value?: string;
      username?: string;
      password?: string;
    };
    bodyTemplate?: string;
    outputPath?: string;
  };

  return {
    type: "http",
    agentId: agent.id,
    url: config.url,
    method: config.method,
    headers: config.headers ?? [],
    auth: config.auth,
    bodyTemplate: config.bodyTemplate,
    outputPath: config.outputPath,
  };
}

// ============================================================================
// Factory Function (wires up production dependencies)
// ============================================================================

/**
 * Creates production dependencies for the data prefetcher.
 *
 * This factory wires up the real implementations:
 * - ScenarioService for scenario lookup
 * - PromptService for prompt lookup
 * - AgentRepository for agent lookup
 * - Prisma for project lookup
 * - Model providers for LiteLLM params
 */
export function createDataPrefetcherDependencies(): DataPrefetcherDependencies {
  const scenarioService = ScenarioService.create(prisma);
  const promptService = new PromptService(prisma);
  const agentRepository = new AgentRepository(prisma);

  return {
    scenarioFetcher: {
      getById: (params) => scenarioService.getById(params),
    },
    promptFetcher: {
      getPromptByIdOrHandle: (params) =>
        promptService.getPromptByIdOrHandle(params),
    },
    agentFetcher: {
      findById: (params) => agentRepository.findById(params),
    },
    projectFetcher: {
      findUnique: async (projectId) =>
        prisma.project.findUnique({
          where: { id: projectId },
          select: { apiKey: true, defaultModel: true },
        }),
    },
    modelParamsProvider: {
      prepare: async (projectId, model) => {
        try {
          const providers = await getProjectModelProviders(projectId);
          const providerKey = model.split("/")[0];
          if (!providerKey) return null;

          const provider = providers[providerKey];
          if (!provider?.enabled) return null;

          const params = await prepareLitellmParams({
            model,
            modelProvider: provider,
            projectId,
          });
          if (!params.api_key || !params.model) return null;

          return params as LiteLLMParams;
        } catch {
          return null;
        }
      },
    },
  };
}
