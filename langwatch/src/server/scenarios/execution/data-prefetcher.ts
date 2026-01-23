/**
 * Pre-fetches all data needed for child process scenario execution.
 *
 * Gathers scenario config, project info, model params, and adapter data
 * so the child process can run without DB access.
 */

import { env } from "~/env.mjs";
import { DEFAULT_MODEL } from "~/utils/constants";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../api/routers/modelProviders";
import { AgentRepository } from "../../agents/agent.repository";
import { prisma } from "../../db";
import { PromptService } from "../../prompt-config/prompt.service";
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

/**
 * Pre-fetch all data needed for scenario execution.
 */
export async function prefetchScenarioData(
  context: ExecutionContext,
  target: TargetConfig,
): Promise<PrefetchResult> {
  const scenario = await fetchScenario(context.projectId, context.scenarioId);
  if (!scenario) {
    return { success: false, error: `Scenario ${context.scenarioId} not found` };
  }

  const projectResult = await fetchProject(context.projectId);
  if (!projectResult.success) {
    return { success: false, error: projectResult.error };
  }
  const project = projectResult.data;

  const adapterData = await fetchAdapterData(context.projectId, target);
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
  const modelParams = await fetchModelParams(context.projectId, modelForParams);
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
      endpoint: env.BASE_HOST,
      apiKey: project.apiKey,
    },
  };
}

async function fetchScenario(
  projectId: string,
  scenarioId: string,
): Promise<ScenarioConfig | null> {
  const service = ScenarioService.create(prisma);
  const scenario = await service.getById({ projectId, id: scenarioId });
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

async function fetchProject(projectId: string): Promise<FetchProjectResult> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { apiKey: true, defaultModel: true },
  });
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

async function fetchModelParams(
  projectId: string,
  model: string,
): Promise<LiteLLMParams | null> {
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
}

async function fetchAdapterData(
  projectId: string,
  target: TargetConfig,
): Promise<TargetAdapterData | null> {
  if (target.type === "prompt") {
    return fetchPromptConfigData(projectId, target.referenceId);
  }
  return fetchHttpAgentData(projectId, target.referenceId);
}

async function fetchPromptConfigData(
  projectId: string,
  promptId: string,
): Promise<PromptConfigData | null> {
  const service = new PromptService(prisma);
  const prompt = await service.getPromptByIdOrHandle({ projectId, idOrHandle: promptId });
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
): Promise<HttpAgentData | null> {
  const repo = new AgentRepository(prisma);
  const agent = await repo.findById({ projectId, id: agentId });
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
