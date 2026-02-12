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

import { z } from "zod";
import { env } from "~/env.mjs";
import { DEFAULT_MODEL } from "~/utils/constants";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:scenarios:data-prefetcher");
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../api/routers/modelProviders";
import { AgentRepository, type TypedAgent } from "../../agents/agent.repository";
import { prisma } from "../../db";
import { PromptService, type VersionedPrompt } from "../../prompt-config/prompt.service";
import { ScenarioService } from "../scenario.service";
import {
  AuthConfigSchema,
  type ChildProcessJobData,
  type CodeAgentData,
  type ExecutionContext,
  type HttpAgentData,
  type LiteLLMParams,
  type PromptConfigData,
  type ScenarioConfig,
  type TargetAdapterData,
  type TargetConfig,
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

/** Reason codes for model params preparation failures */
export type ModelParamsFailureReason =
  | "invalid_model_format"
  | "provider_not_found"
  | "provider_not_enabled"
  | "missing_params"
  | "preparation_error";

/** Structured result from model params preparation */
export type ModelParamsResult =
  | { success: true; params: LiteLLMParams }
  | { success: false; reason: ModelParamsFailureReason; message: string };

/** Minimal interface for model params preparation */
export interface ModelParamsProvider {
  prepare(projectId: string, model: string): Promise<ModelParamsResult>;
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
      reason?: ModelParamsFailureReason;
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
  logger.debug(
    { projectId: context.projectId, scenarioId: context.scenarioId, batchRunId: context.batchRunId, targetType: target.type },
    "Prefetching scenario data",
  );

  const scenario = await fetchScenario(
    context.projectId,
    context.scenarioId,
    deps.scenarioFetcher,
  );
  if (!scenario) {
    logger.warn({ projectId: context.projectId, scenarioId: context.scenarioId }, "Scenario not found");
    return { success: false, error: `Scenario ${context.scenarioId} not found` };
  }

  const projectResult = await fetchProject(context.projectId, deps.projectFetcher);
  if (!projectResult.success) {
    logger.warn({ projectId: context.projectId, error: projectResult.error }, "Project fetch failed");
    return { success: false, error: projectResult.error };
  }
  const project = projectResult.data;

  const adapterData = await fetchAgentData(context.projectId, target, deps);
  if (!adapterData) {
    logger.warn(
      { projectId: context.projectId, targetType: target.type, targetReferenceId: target.referenceId },
      "Target adapter not found",
    );
    const targetLabel = target.type === "prompt" ? "Prompt" : target.type === "code" ? "Code agent" : "HTTP agent";
    return {
      success: false,
      error: `${targetLabel} ${target.referenceId} not found`,
    };
  }

  // When target is a prompt, use the prompt's configured model for fetching model params
  const modelForParams =
    adapterData.type === "prompt" && adapterData.model
      ? adapterData.model
      : project.defaultModel;
  const modelParamsResult = await deps.modelParamsProvider.prepare(
    context.projectId,
    modelForParams,
  );
  if (!modelParamsResult.success) {
    logger.warn(
      { projectId: context.projectId, model: modelForParams, reason: modelParamsResult.reason },
      `Failed to prepare model params: ${modelParamsResult.message}`,
    );
    return { success: false, error: modelParamsResult.message, reason: modelParamsResult.reason };
  }
  const modelParams = modelParamsResult.params;

  logger.debug(
    { projectId: context.projectId, scenarioId: context.scenarioId, targetType: target.type },
    "Prefetch complete",
  );

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
  if (!project) {
    return { success: false, error: `Project ${projectId} not found` };
  }
  if (!project.apiKey) {
    return { success: false, error: `Project ${projectId} missing API key` };
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

async function fetchAgentData(
  projectId: string,
  target: TargetConfig,
  deps: DataPrefetcherDependencies,
): Promise<TargetAdapterData | null> {
  if (target.type === "prompt") {
    return fetchPromptConfigData(projectId, target.referenceId, deps.promptFetcher);
  }
  if (target.type === "code") {
    return fetchCodeAgentData(projectId, target.referenceId, deps.agentFetcher);
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

/**
 * Zod schema for HTTP agent config validation.
 * Used to safely parse agent.config instead of unsafe type assertion.
 */
const HttpAgentConfigSchema = z.object({
  url: z.string(),
  method: z.string(),
  headers: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  auth: AuthConfigSchema.optional(),
  bodyTemplate: z.string().optional(),
  outputPath: z.string().optional(),
});

async function fetchHttpAgentData(
  projectId: string,
  agentId: string,
  fetcher: AgentFetcher,
): Promise<HttpAgentData | null> {
  const agent = await fetcher.findById({ projectId, id: agentId });
  if (!agent || agent.type !== "http") return null;

  const parseResult = HttpAgentConfigSchema.safeParse(agent.config);
  if (!parseResult.success) {
    return null;
  }
  const config = parseResult.data;

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

/**
 * Zod schema for code agent config validation.
 * Code agents have a parameters array with a "code" entry, plus inputs/outputs.
 */
const RawCodeAgentConfigSchema = z.object({
  parameters: z.array(z.object({
    identifier: z.string(),
    type: z.string(),
    value: z.string().optional(),
  })),
  inputs: z.array(z.object({
    identifier: z.string(),
    type: z.string(),
  })).optional(),
  outputs: z.array(z.object({
    identifier: z.string(),
    type: z.string(),
  })).optional(),
});

async function fetchCodeAgentData(
  projectId: string,
  agentId: string,
  fetcher: AgentFetcher,
): Promise<CodeAgentData | null> {
  const agent = await fetcher.findById({ projectId, id: agentId });
  if (!agent || agent.type !== "code") return null;

  const parseResult = RawCodeAgentConfigSchema.safeParse(agent.config);
  if (!parseResult.success) {
    return null;
  }
  const config = parseResult.data;

  const codeParam = config.parameters.find(
    (p) => p.identifier === "code" && p.type === "code",
  );
  if (!codeParam?.value) {
    return null;
  }

  return {
    type: "code",
    agentId: agent.id,
    code: codeParam.value,
    inputs: config.inputs ?? [],
    outputs: config.outputs ?? [],
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
      prepare: async (projectId, model): Promise<ModelParamsResult> => {
        try {
          const providerKey = model.split("/")[0];
          if (!providerKey) {
            return {
              success: false,
              reason: "invalid_model_format",
              message: `Invalid model format '${model}' - expected 'provider/model' format (e.g., 'openai/gpt-4')`,
            };
          }

          const providers = await getProjectModelProviders(projectId);
          const provider = providers[providerKey];

          if (!provider) {
            return {
              success: false,
              reason: "provider_not_found",
              message: `Provider '${providerKey}' not found for this project. Available providers: ${Object.keys(providers).join(", ") || "none"}`,
            };
          }

          if (!provider.enabled) {
            return {
              success: false,
              reason: "provider_not_enabled",
              message: `Provider '${providerKey}' is not enabled for this project. Enable it in Settings > Model Providers.`,
            };
          }

          const params = await prepareLitellmParams({
            model,
            modelProvider: provider,
            projectId,
          });

          if (!params.api_key || !params.model) {
            const missing = [];
            if (!params.api_key) missing.push("API key");
            if (!params.model) missing.push("model");
            return {
              success: false,
              reason: "missing_params",
              message: `Provider '${providerKey}' is missing required configuration: ${missing.join(" and ")}. Check Settings > Model Providers.`,
            };
          }

          return { success: true, params: params as LiteLLMParams };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error({ error }, "failed to prepare LiteLLM params");
          return {
            success: false,
            reason: "preparation_error",
            message: `Unexpected error preparing model params: ${errorMessage}`,
          };
        }
      },
    },
  };
}
