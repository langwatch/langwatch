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

import { createLogger } from "@langwatch/observability";
import type { Edge, Node } from "@xyflow/react";
import { z } from "zod";
import { env } from "~/env.mjs";
import { normalizeToSnakeCase } from "~/optimization_studio/components/properties/llm-configs/normalizeToSnakeCase";
import { DEFAULT_MODEL } from "~/utils/constants";
import { getInputsOutputs } from "../../../optimization_studio/utils/nodeUtils";
import { resolveModelForFeature } from "../../modelProviders/resolveModelForFeature";
import { extractSuiteId } from "../../suites/suite-set-id";
import { validateWorkflowAgentMappings } from "./validate-workflow-mappings";

const logger = createLogger("langwatch:scenarios:data-prefetcher");

import { decrypt } from "~/utils/encryption";
import {
  AgentRepository,
  type TypedAgent,
} from "../../agents/agent.repository";
import {
  getProjectModelProviders,
  prepareLitellmParams,
} from "../../api/routers/modelProviders.utils";
import { prisma } from "../../db";
import {
  PromptService,
  type VersionedPrompt,
} from "../../prompt-config/prompt.service";
import { ScenarioService } from "../scenario.service";
import {
  AuthConfigSchema,
  type ChildProcessJobData,
  type CodeAgentData,
  type ExecutionContext,
  FieldMappingSchema,
  type HttpAgentData,
  type LiteLLMParams,
  type PromptConfigData,
  type ScenarioConfig,
  type TargetAdapterData,
  type TargetConfig,
  type WorkflowAgentData,
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
    /** Per-scenario user-simulator model override (null = use default). */
    simulatorModel?: string | null;
    /** Per-scenario judge model override (null = use default). */
    judgeModel?: string | null;
  } | null>;
}

/**
 * Resolves run-plan-level (suite) simulator/judge model overrides for a
 * scenario run. The set id encodes the suite (see `getSuiteSetId`), so the
 * prefetcher can pick up a run plan's choices without threading them through
 * the event-sourcing queue. Returns null when the run is not part of a suite.
 */
export interface SuiteModelFetcher {
  getBySetId(
    setId: string,
    projectId: string,
  ): Promise<{
    simulatorModel: string | null;
    judgeModel: string | null;
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
  findById(params: {
    projectId: string;
    id: string;
  }): Promise<TypedAgent | null>;
}

/**
 * Minimal interface for workflow version lookup - loads the latest DSL
 * for a workflow so the worker-thread adapter can execute it without DB access.
 */
export interface WorkflowVersionFetcher {
  getLatestDsl(params: {
    projectId: string;
    workflowId: string;
  }): Promise<{ workflowId: string; dsl: Record<string, unknown> } | null>;
}

/** Minimal interface for project lookup */
export interface ProjectFetcher {
  findUnique(projectId: string): Promise<{
    apiKey: string | null;
  } | null>;
}

/**
 * Minimal interface for resolving the DEFAULT model at a project's
 * cascade. Throws ModelNotConfiguredError when nothing is set; the
 * prefetcher catches and returns a structured failure to the caller.
 */
export interface ModelResolver {
  resolve(featureKey: string, projectId: string): Promise<string>;
}

/**
 * Loads decrypted project secrets (name → plaintext value) for injection into
 * code and workflow agent DSL payloads. Mirrors the studio's addEnvs behavior
 * so `secrets.NAME` resolves the same way whether the workflow runs from the
 * UI or from a scenario worker.
 */
export interface ProjectSecretsFetcher {
  getSecrets(projectId: string): Promise<Record<string, string>>;
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
  suiteModelFetcher: SuiteModelFetcher;
  promptFetcher: PromptFetcher;
  agentFetcher: AgentFetcher;
  workflowVersionFetcher: WorkflowVersionFetcher;
  projectFetcher: ProjectFetcher;
  modelParamsProvider: ModelParamsProvider;
  modelResolver: ModelResolver;
  projectSecretsFetcher: ProjectSecretsFetcher;
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

type PrefetchStepResult<T> =
  | ({ ok: true } & T)
  | { ok: false; result: PrefetchResult };

async function resolveScenarioOrFail({
  context,
  scenarioFetcher,
}: {
  context: ExecutionContext;
  scenarioFetcher: ScenarioFetcher;
}): Promise<
  PrefetchStepResult<{
    scenarioResult: NonNullable<Awaited<ReturnType<typeof fetchScenario>>>;
  }>
> {
  const scenarioResult = await fetchScenario(
    context.projectId,
    context.scenarioId,
    scenarioFetcher,
  );
  if (!scenarioResult) {
    logger.warn(
      { projectId: context.projectId, scenarioId: context.scenarioId },
      "Scenario not found",
    );
    return {
      ok: false,
      result: {
        success: false,
        error: `Scenario ${context.scenarioId} not found`,
      },
    };
  }
  return { ok: true, scenarioResult };
}

async function resolveProjectOrFail({
  context,
  projectFetcher,
}: {
  context: ExecutionContext;
  projectFetcher: ProjectFetcher;
}): Promise<PrefetchStepResult<{ project: { apiKey: string } }>> {
  const projectResult = await fetchProject(context.projectId, projectFetcher);
  if (!projectResult.success) {
    logger.warn(
      { projectId: context.projectId, error: projectResult.error },
      "Project fetch failed",
    );
    return {
      ok: false,
      result: { success: false, error: projectResult.error },
    };
  }
  return { ok: true, project: projectResult.data };
}

function targetLabelFor(target: TargetConfig): string {
  if (target.type === "prompt") return "Prompt";
  if (target.type === "code") return "Code agent";
  if (target.type === "workflow") return "Workflow agent";
  return "HTTP agent";
}

async function resolveAdapterDataOrFail({
  context,
  target,
  deps,
}: {
  context: ExecutionContext;
  target: TargetConfig;
  deps: DataPrefetcherDependencies;
}): Promise<PrefetchStepResult<{ adapterData: TargetAdapterData }>> {
  const adapterResult = await fetchAgentData(context.projectId, target, deps);
  if (
    adapterResult !== null &&
    "success" in adapterResult &&
    !adapterResult.success
  ) {
    // Hydration failure from workflow DSL — surface structured error
    logger.warn(
      {
        projectId: context.projectId,
        targetType: target.type,
        reason: adapterResult.reason,
      },
      `Workflow LLM hydration failed: ${adapterResult.message}`,
    );
    return {
      ok: false,
      result: {
        success: false,
        error: adapterResult.message,
        reason: adapterResult.reason,
      },
    };
  }
  const adapterData = adapterResult as TargetAdapterData | null;
  if (!adapterData) {
    logger.warn(
      {
        projectId: context.projectId,
        targetType: target.type,
        targetReferenceId: target.referenceId,
      },
      "Target adapter not found",
    );
    return {
      ok: false,
      result: {
        success: false,
        error: `${targetLabelFor(target)} ${target.referenceId} not found`,
      },
    };
  }
  return { ok: true, adapterData };
}

// Resolve the three model roles a run needs:
//   - the target adapter (prompt / workflow under test): the prompt's own
//     model when set, else the project's scenarios.generator default.
//   - the user-simulator and the judge: a run-plan override, else the
//     scenario's own override, else the DEFAULT-role scenarios.user_simulator
//     / scenarios.judge model. The split lets the role-play and evaluation
//     use a smart model independently of the agent under test.
// ModelNotConfiguredError bubbles as a structured "model not configured"
// failure with the resolver's message.
async function resolveModelRolesOrFail({
  context,
  adapterData,
  scenarioResult,
  deps,
}: {
  context: ExecutionContext;
  adapterData: TargetAdapterData;
  scenarioResult: {
    simulatorModel: string | null;
    judgeModel: string | null;
  };
  deps: DataPrefetcherDependencies;
}): Promise<
  PrefetchStepResult<{
    modelForParams: string;
    simulatorModel: string;
    judgeModel: string;
  }>
> {
  const suiteOverrides = await deps.suiteModelFetcher.getBySetId(
    context.setId,
    context.projectId,
  );
  try {
    const modelForParams =
      adapterData.type === "prompt" && adapterData.model
        ? adapterData.model
        : await deps.modelResolver.resolve(
            "scenarios.generator",
            context.projectId,
          );
    const simulatorModel =
      suiteOverrides?.simulatorModel ??
      scenarioResult.simulatorModel ??
      (await deps.modelResolver.resolve(
        "scenarios.user_simulator",
        context.projectId,
      ));
    const judgeModel =
      suiteOverrides?.judgeModel ??
      scenarioResult.judgeModel ??
      (await deps.modelResolver.resolve("scenarios.judge", context.projectId));
    return { ok: true, modelForParams, simulatorModel, judgeModel };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "No default model configured for this project";
    return { ok: false, result: { success: false, error: message } };
  }
}

async function prepareAllModelParamsOrFail({
  context,
  modelForParams,
  simulatorModel,
  judgeModel,
  modelParamsProvider,
}: {
  context: ExecutionContext;
  modelForParams: string;
  simulatorModel: string;
  judgeModel: string;
  modelParamsProvider: ModelParamsProvider;
}): Promise<
  PrefetchStepResult<{
    modelParams: LiteLLMParams;
    simulatorModelParams: LiteLLMParams;
    judgeModelParams: LiteLLMParams;
  }>
> {
  const [modelParamsResult, simulatorParamsResult, judgeParamsResult] =
    await Promise.all([
      modelParamsProvider.prepare(context.projectId, modelForParams),
      modelParamsProvider.prepare(context.projectId, simulatorModel),
      modelParamsProvider.prepare(context.projectId, judgeModel),
    ]);
  for (const { label, model, result } of [
    { label: "adapter", model: modelForParams, result: modelParamsResult },
    {
      label: "user-simulator",
      model: simulatorModel,
      result: simulatorParamsResult,
    },
    { label: "judge", model: judgeModel, result: judgeParamsResult },
  ]) {
    if (!result.success) {
      logger.warn(
        {
          projectId: context.projectId,
          role: label,
          model,
          reason: result.reason,
        },
        `Failed to prepare model params: ${result.message}`,
      );
      return {
        ok: false,
        result: {
          success: false,
          error: result.message,
          reason: result.reason,
        },
      };
    }
  }
  // Narrowing: the loop above returns on any failure, so all three succeeded.
  if (
    !modelParamsResult.success ||
    !simulatorParamsResult.success ||
    !judgeParamsResult.success
  ) {
    return {
      ok: false,
      result: { success: false, error: "Failed to prepare model params" },
    };
  }

  return {
    ok: true,
    modelParams: modelParamsResult.params,
    simulatorModelParams: simulatorParamsResult.params,
    judgeModelParams: judgeParamsResult.params,
  };
}

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
    {
      projectId: context.projectId,
      scenarioId: context.scenarioId,
      batchRunId: context.batchRunId,
      targetType: target.type,
    },
    "Prefetching scenario data",
  );

  const scenarioStep = await resolveScenarioOrFail({
    context,
    scenarioFetcher: deps.scenarioFetcher,
  });
  if (!scenarioStep.ok) return scenarioStep.result;
  const { scenarioResult } = scenarioStep;
  const scenario = scenarioResult.config;

  const projectStep = await resolveProjectOrFail({
    context,
    projectFetcher: deps.projectFetcher,
  });
  if (!projectStep.ok) return projectStep.result;
  const { project } = projectStep;

  const adapterStep = await resolveAdapterDataOrFail({ context, target, deps });
  if (!adapterStep.ok) return adapterStep.result;
  const { adapterData } = adapterStep;

  const modelRolesStep = await resolveModelRolesOrFail({
    context,
    adapterData,
    scenarioResult,
    deps,
  });
  if (!modelRolesStep.ok) return modelRolesStep.result;
  const { modelForParams, simulatorModel, judgeModel } = modelRolesStep;

  const modelParamsStep = await prepareAllModelParamsOrFail({
    context,
    modelForParams,
    simulatorModel,
    judgeModel,
    modelParamsProvider: deps.modelParamsProvider,
  });
  if (!modelParamsStep.ok) return modelParamsStep.result;
  const { modelParams, simulatorModelParams, judgeModelParams } =
    modelParamsStep;

  logger.debug(
    {
      projectId: context.projectId,
      scenarioId: context.scenarioId,
      targetType: target.type,
    },
    "Prefetch complete",
  );

  return {
    success: true,
    data: {
      context,
      scenario,
      adapterData,
      modelParams,
      simulatorModelParams,
      judgeModelParams,
      nlpServiceUrl: env.LANGWATCH_NLP_SERVICE,
      target,
    },
    telemetry: {
      endpoint: env.LANGWATCH_ENDPOINT,
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
): Promise<{
  config: ScenarioConfig;
  simulatorModel: string | null;
  judgeModel: string | null;
} | null> {
  const scenario = await fetcher.getById({ projectId, id: scenarioId });
  if (!scenario) return null;
  return {
    config: {
      id: scenario.id,
      name: scenario.name,
      situation: scenario.situation,
      criteria: scenario.criteria,
      labels: scenario.labels,
    },
    simulatorModel: scenario.simulatorModel ?? null,
    judgeModel: scenario.judgeModel ?? null,
  };
}

type FetchProjectResult =
  | { success: true; data: { apiKey: string } }
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
  return { success: true, data: { apiKey: project.apiKey } };
}

/** Failure result propagated from hydrateLlmParameters through the fetch chain */
type HydrationFailure = {
  success: false;
  reason: ModelParamsFailureReason;
  message: string;
};

async function fetchAgentData(
  projectId: string,
  target: TargetConfig,
  deps: DataPrefetcherDependencies,
): Promise<TargetAdapterData | HydrationFailure | null> {
  if (target.type === "prompt") {
    return fetchPromptConfigData(
      projectId,
      target.referenceId,
      deps.promptFetcher,
    );
  }
  if (target.type === "code") {
    return fetchCodeAgentData({
      projectId,
      agentId: target.referenceId,
      fetcher: deps.agentFetcher,
      projectSecretsFetcher: deps.projectSecretsFetcher,
    });
  }
  if (target.type === "workflow") {
    return fetchWorkflowAgentData({
      projectId,
      agentId: target.referenceId,
      agentFetcher: deps.agentFetcher,
      workflowVersionFetcher: deps.workflowVersionFetcher,
      modelParamsProvider: deps.modelParamsProvider,
      projectSecretsFetcher: deps.projectSecretsFetcher,
    });
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
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
});

async function fetchHttpAgentData(
  projectId: string,
  agentId: string,
  fetcher: AgentFetcher,
): Promise<HttpAgentData | null> {
  const agent = await fetcher.findById({ projectId, id: agentId });
  if (agent?.type !== "http") return null;

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
    scenarioMappings: config.scenarioMappings,
  };
}

/**
 * Zod schema for code agent config validation.
 * Code agents have a parameters array with a "code" entry, plus inputs/outputs.
 */
const RawCodeAgentConfigSchema = z.object({
  parameters: z.array(
    z.object({
      identifier: z.string(),
      type: z.string(),
      value: z.string().optional(),
    }),
  ),
  inputs: z
    .array(
      z.object({
        identifier: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
  outputs: z
    .array(
      z.object({
        identifier: z.string(),
        type: z.string(),
      }),
    )
    .optional(),
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
  scenarioOutputField: z.string().optional(),
});

async function fetchCodeAgentData({
  projectId,
  agentId,
  fetcher,
  projectSecretsFetcher,
}: {
  projectId: string;
  agentId: string;
  fetcher: AgentFetcher;
  projectSecretsFetcher: ProjectSecretsFetcher;
}): Promise<CodeAgentData | null> {
  const agent = await fetcher.findById({ projectId, id: agentId });
  if (agent?.type !== "code") return null;

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

  const secrets = await projectSecretsFetcher.getSecrets(projectId);

  return {
    type: "code",
    agentId: agent.id,
    code: codeParam.value,
    inputs: config.inputs ?? [],
    outputs: config.outputs ?? [],
    scenarioMappings: config.scenarioMappings,
    scenarioOutputField: config.scenarioOutputField,
    secrets,
  };
}

/**
 * Zod schema for workflow agent config validation.
 * Workflow agents reference a workflow by id; scenarioMappings/scenarioOutputField
 * are the same shape used by code and HTTP agents.
 */
const RawWorkflowAgentConfigSchema = z.object({
  workflow_id: z.string().optional(),
  scenarioMappings: z.record(z.string(), FieldMappingSchema).optional(),
  scenarioOutputField: z.string().optional(),
});

/** Shape of entry/end node fields extracted from a workflow DSL. */
interface WorkflowField {
  identifier: string;
  type: string;
}

async function fetchWorkflowAgentData({
  projectId,
  agentId,
  agentFetcher,
  workflowVersionFetcher,
  modelParamsProvider,
  projectSecretsFetcher,
}: {
  projectId: string;
  agentId: string;
  agentFetcher: AgentFetcher;
  workflowVersionFetcher: WorkflowVersionFetcher;
  modelParamsProvider: ModelParamsProvider;
  projectSecretsFetcher: ProjectSecretsFetcher;
}): Promise<WorkflowAgentData | HydrationFailure | null> {
  const agent = await agentFetcher.findById({ projectId, id: agentId });
  if (agent?.type !== "workflow") return null;

  const parseResult = RawWorkflowAgentConfigSchema.safeParse(agent.config);
  if (!parseResult.success) return null;
  const config = parseResult.data;

  // workflowId can live on the Agent row or inside the DSL config. Prefer the
  // agent row (set when the agent was created by WorkflowSelectorDrawer).
  const workflowId =
    (agent as TypedAgent & { workflowId?: string | null }).workflowId ??
    config.workflow_id ??
    null;
  if (!workflowId) return null;

  const latest = await workflowVersionFetcher.getLatestDsl({
    projectId,
    workflowId,
  });
  if (!latest) return null;

  const hydrateResult = await hydrateLlmParameters({
    dsl: latest.dsl,
    projectId,
    modelParamsProvider,
  });

  if (!hydrateResult.success) {
    return {
      success: false,
      reason: hydrateResult.reason,
      message: hydrateResult.message,
    };
  }

  const { inputs, outputs } = extractWorkflowIO(hydrateResult.dsl);

  const secrets = await projectSecretsFetcher.getSecrets(projectId);

  const data: WorkflowAgentData = {
    type: "workflow",
    agentId: agent.id,
    workflowId: latest.workflowId,
    workflow: hydrateResult.dsl,
    inputs,
    outputs,
    scenarioMappings: config.scenarioMappings,
    scenarioOutputField: config.scenarioOutputField,
    secrets,
  };

  validateWorkflowAgentMappings(data);

  return data;
}

/** Discriminated result type returned by hydrateLlmParameters */
type HydrateLlmResult =
  | { success: true; dsl: Record<string, unknown> }
  | { success: false; reason: ModelParamsFailureReason; message: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Legacy `default_llm` fallback resolved once per DSL hydration pass. */
interface LlmHydrationDefaults {
  defaultModel: string | undefined;
  defaultLlm: Record<string, unknown> | null;
}

// Legacy fallback. `default_llm` only exists on raw persisted DSLs from
// spec_version <= 1.4 (nodes own their config since 1.5); this reader
// keeps tolerating it because scenario agents can reference old workflow
// versions that were never re-saved. On 1.5+ DSLs a modelless llm
// parameter is stale state and must NOT be silently substituted — leave
// it unhydrated so the engine raises its typed llm_model_not_set error.
function resolveLlmHydrationDefaults(
  dsl: Record<string, unknown>,
): LlmHydrationDefaults {
  const specParts =
    typeof dsl.spec_version === "string"
      ? dsl.spec_version.split(".").map(Number)
      : [];
  const specMajor = specParts[0] ?? NaN;
  const specMinor = specParts[1] ?? 0;
  const legacyDsl =
    !Number.isFinite(specMajor) ||
    !Number.isFinite(specMinor) ||
    specMajor < 1 ||
    (specMajor === 1 && specMinor < 5);
  const defaultLlm = legacyDsl ? asRecord(dsl.default_llm) : null;
  const defaultModel = legacyDsl
    ? typeof defaultLlm?.model === "string" && defaultLlm.model.length > 0
      ? defaultLlm.model
      : DEFAULT_MODEL
    : undefined;
  return { defaultModel, defaultLlm };
}

function extractLlmParamModel({
  param,
  defaultModel,
}: {
  param: unknown;
  defaultModel: string | undefined;
}): string | undefined {
  const p = asRecord(param);
  if (p?.type !== "llm") return undefined;
  const value = asRecord(p.value);
  return typeof value?.model === "string" && value.model.length > 0
    ? value.model
    : defaultModel;
}

// Collect unique models needed before hitting the provider
function collectModelsNeeded({
  nodes,
  defaultModel,
}: {
  nodes: unknown[];
  defaultModel: string | undefined;
}): Set<string> {
  const modelsNeeded = new Set<string>();
  for (const node of nodes) {
    const n = asRecord(node);
    if (!n) continue;
    const nodeData = asRecord(n.data);
    const parameters = asArray(nodeData?.parameters);
    for (const param of parameters) {
      const model = extractLlmParamModel({ param, defaultModel });
      if (model) modelsNeeded.add(model);
    }
  }
  return modelsNeeded;
}

type LitellmParamsLookup = Map<string, Record<string, unknown>>;

type PrepareLitellmParamsResult =
  | { success: true; litellmParamsByModel: LitellmParamsLookup }
  | { success: false; reason: ModelParamsFailureReason; message: string };

// Fetch litellm_params for each unique model — fail fast on first failure.
// Partial hydration is not safe: a partially-hydrated DSL still reaches the
// NLP service with "dummy" api_key for the un-hydrated nodes.
async function prepareLitellmParamsByModel({
  modelsNeeded,
  projectId,
  modelParamsProvider,
}: {
  modelsNeeded: Set<string>;
  projectId: string;
  modelParamsProvider: ModelParamsProvider;
}): Promise<PrepareLitellmParamsResult> {
  const litellmParamsByModel: LitellmParamsLookup = new Map();
  const prepareResults = await Promise.all(
    Array.from(modelsNeeded).map(async (model) => {
      const result = await modelParamsProvider.prepare(projectId, model);
      return { model, result };
    }),
  );

  for (const { model, result } of prepareResults) {
    if (!result.success) {
      logger.warn(
        { projectId, model, reason: result.reason },
        `Failed to hydrate llm parameter: ${result.message}`,
      );
      return { success: false, reason: result.reason, message: result.message };
    }
    litellmParamsByModel.set(model, result.params as Record<string, unknown>);
  }

  return { success: true, litellmParamsByModel };
}

function hydrateLlmParam({
  param,
  defaultModel,
  defaultLlm,
  litellmParamsByModel,
}: {
  param: unknown;
  defaultModel: string | undefined;
  defaultLlm: Record<string, unknown> | null;
  litellmParamsByModel: LitellmParamsLookup;
}): unknown {
  const p = asRecord(param);
  if (p?.type !== "llm") return param;

  const existingValue = asRecord(p.value);
  const model =
    typeof existingValue?.model === "string" && existingValue.model.length > 0
      ? existingValue.model
      : defaultModel;
  if (!model) return param;

  const litellmParams = litellmParamsByModel.get(model);
  if (!litellmParams) return param;

  // Use existing value if present, otherwise fall back to default_llm or { model }.
  // Normalize to snake_case to match addEnvs.ts behaviour (e.g. maxTokens → max_tokens).
  const rawBaseValue = existingValue ?? defaultLlm ?? { model };
  // Cast through unknown then to the expected intersection type — rawBaseValue is opaque
  // Record<string, unknown> from the DSL and normalizeToSnakeCase is safe on any object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const normalizedBase = normalizeToSnakeCase(rawBaseValue as any);

  // Guarantee top-level `model` — partial existingValue (e.g. only `temperature`) would
  // otherwise pass through without one, diverging from addEnvs.ts which derives model via
  // LLMConfig contract. Downstream NLP reads value.model directly.
  return {
    ...p,
    value: { ...normalizedBase, model, litellm_params: litellmParams },
  };
}

function hydrateLlmNode({
  node,
  defaultModel,
  defaultLlm,
  litellmParamsByModel,
}: {
  node: unknown;
  defaultModel: string | undefined;
  defaultLlm: Record<string, unknown> | null;
  litellmParamsByModel: LitellmParamsLookup;
}): unknown {
  const n = asRecord(node);
  if (!n) return node;
  const data = asRecord(n.data);
  if (!data) return node;

  const parameters = Array.isArray(data.parameters)
    ? (data.parameters as unknown[])
    : null;
  if (!parameters) return node;

  const hydratedParams = parameters.map((param) =>
    hydrateLlmParam({ param, defaultModel, defaultLlm, litellmParamsByModel }),
  );

  return { ...n, data: { ...data, parameters: hydratedParams } };
}

/**
 * Injects litellm_params into every llm-type parameter across all DSL nodes.
 *
 * Mirrors addEnvs.ts node-parameter hydration but uses the prefetcher's
 * ModelParamsProvider abstraction so the child process never needs DB access.
 * We dedupe by model string to avoid N provider lookups for N identical nodes.
 *
 * Provider-lookup failures are surfaced as structured failures rather than
 * silently skipped — a partial hydration still reaches the NLP service with
 * "dummy" api_key and causes the same AuthenticationError this PR fixes.
 */
async function hydrateLlmParameters({
  dsl,
  projectId,
  modelParamsProvider,
}: {
  dsl: Record<string, unknown>;
  projectId: string;
  modelParamsProvider: ModelParamsProvider;
}): Promise<HydrateLlmResult> {
  const nodes = asArray(dsl.nodes);
  if (nodes.length === 0) return { success: true, dsl };

  const { defaultModel, defaultLlm } = resolveLlmHydrationDefaults(dsl);

  const modelsNeeded = collectModelsNeeded({ nodes, defaultModel });
  if (modelsNeeded.size === 0) return { success: true, dsl };

  const litellmResult = await prepareLitellmParamsByModel({
    modelsNeeded,
    projectId,
    modelParamsProvider,
  });
  if (!litellmResult.success) {
    return {
      success: false,
      reason: litellmResult.reason,
      message: litellmResult.message,
    };
  }

  const hydratedNodes = nodes.map((node) =>
    hydrateLlmNode({
      node,
      defaultModel,
      defaultLlm,
      litellmParamsByModel: litellmResult.litellmParamsByModel,
    }),
  );

  return { success: true, dsl: { ...dsl, nodes: hydratedNodes } };
}

/**
 * Extract declared entry inputs and end outputs from an opaque workflow DSL.
 *
 * The DSL is stored as `Record<string, unknown>` (JSON column), so we narrow
 * into the `Edge[]`/`Node[]` shape `getInputsOutputs` expects and then flatten
 * its loose return value into typed `WorkflowField`s. Workflows without an
 * entry/end node yield empty arrays; the adapter synthesises a single
 * `input`/`output` identifier as a fallback.
 */
function extractWorkflowIO(dsl: Record<string, unknown>): {
  inputs: WorkflowField[];
  outputs: WorkflowField[];
} {
  const nodes = (Array.isArray(dsl.nodes) ? dsl.nodes : []) as Node[];
  const edges = (Array.isArray(dsl.edges) ? dsl.edges : []) as Edge[];

  const { inputs: rawInputs, outputs: rawOutputs } = getInputsOutputs(
    edges,
    nodes,
  );

  const inputs: WorkflowField[] = (rawInputs ?? []).flatMap((i) =>
    typeof i.identifier === "string"
      ? [{ identifier: i.identifier, type: "str" }]
      : [],
  );

  const outputs: WorkflowField[] = (
    Array.isArray(rawOutputs) ? rawOutputs : []
  ).flatMap((o: unknown): WorkflowField[] => {
    if (typeof o !== "object" || o === null) return [];
    const field = o as { identifier?: unknown; type?: unknown };
    if (typeof field.identifier !== "string") return [];
    return [
      {
        identifier: field.identifier,
        type: typeof field.type === "string" ? field.type : "str",
      },
    ];
  });

  return { inputs, outputs };
}

// ============================================================================
// Factory Function (wires up production dependencies)
// ============================================================================

async function getSuiteModelOverrides(
  setId: string,
  projectId: string,
): Promise<{
  simulatorModel: string | null;
  judgeModel: string | null;
} | null> {
  const suiteId = extractSuiteId(setId);
  if (!suiteId) return null;
  const suite = await prisma.simulationSuite.findFirst({
    where: { id: suiteId, projectId },
    select: { simulatorModel: true, judgeModel: true },
  });
  if (!suite) return null;
  return {
    simulatorModel: suite.simulatorModel,
    judgeModel: suite.judgeModel,
  };
}

async function getLatestWorkflowDsl({
  projectId,
  workflowId,
}: {
  projectId: string;
  workflowId: string;
}): Promise<{ workflowId: string; dsl: Record<string, unknown> } | null> {
  const workflow = await prisma.workflow.findFirst({
    where: { id: workflowId, projectId, archivedAt: null },
    select: { id: true, latestVersionId: true },
  });
  if (!workflow?.latestVersionId) return null;
  const version = await prisma.workflowVersion.findFirst({
    where: { id: workflow.latestVersionId, projectId },
    select: { dsl: true },
  });
  if (!version) return null;
  return {
    workflowId: workflow.id,
    dsl: version.dsl as unknown as Record<string, unknown>,
  };
}

async function findProjectApiKey(
  projectId: string,
): Promise<{ apiKey: string | null } | null> {
  return prisma.project.findUnique({
    where: { id: projectId },
    select: { apiKey: true },
  });
}

async function resolveModelViaFeature(
  featureKey: string,
  projectId: string,
): Promise<string> {
  const resolved = await resolveModelForFeature(featureKey, {
    prisma,
    projectId,
  });
  return resolved.model;
}

async function getDecryptedProjectSecrets(
  projectId: string,
): Promise<Record<string, string>> {
  const rows = await prisma.projectSecret.findMany({
    where: { projectId },
    select: { name: true, encryptedValue: true },
  });
  const secrets: Record<string, string> = {};
  for (const row of rows) {
    try {
      secrets[row.name] = decrypt(row.encryptedValue);
    } catch (err) {
      // Wrap per-secret so a single corrupt row yields a readable error
      // instead of a raw crypto stack trace surfacing at the caller.
      throw new Error(
        `Failed to decrypt project secret "${row.name}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return secrets;
}

function invalidModelFormatResult(model: string): ModelParamsResult {
  return {
    success: false,
    reason: "invalid_model_format",
    message: `Invalid model format '${model}' - expected 'provider/model' format (e.g., 'openai/gpt-4')`,
  };
}

type ProjectModelProviders = Awaited<
  ReturnType<typeof getProjectModelProviders>
>;

async function resolveModelProviderOrFail(
  providerKey: string,
  projectId: string,
): Promise<
  | { ok: true; provider: ProjectModelProviders[string] }
  | { ok: false; result: ModelParamsResult }
> {
  const providers = await getProjectModelProviders(projectId);
  const provider = providers[providerKey];

  if (!provider) {
    return {
      ok: false,
      result: {
        success: false,
        reason: "provider_not_found",
        message: `Provider '${providerKey}' not found for this project. Available providers: ${Object.keys(providers).join(", ") || "none"}`,
      },
    };
  }

  if (!provider.enabled) {
    return {
      ok: false,
      result: {
        success: false,
        reason: "provider_not_enabled",
        message: `Provider '${providerKey}' is not enabled for this project. Enable it in Settings > Model Providers.`,
      },
    };
  }

  return { ok: true, provider };
}

function validateLitellmParams(
  params: Awaited<ReturnType<typeof prepareLitellmParams>>,
  providerKey: string,
): ModelParamsResult | null {
  const hasCredentials = !!(
    params.api_key ||
    params.vertex_credentials ||
    params.aws_access_key_id
  );
  if (!hasCredentials || !params.model) {
    const missing = [];
    if (!hasCredentials) missing.push("API key");
    if (!params.model) missing.push("model");
    return {
      success: false,
      reason: "missing_params",
      message: `Provider '${providerKey}' is missing required configuration: ${missing.join(" and ")}. Check Settings > Model Providers.`,
    };
  }
  return null;
}

async function prepareModelParams(
  projectId: string,
  model: string,
): Promise<ModelParamsResult> {
  try {
    if (!model.includes("/")) return invalidModelFormatResult(model);

    const providerKey = model.split("/")[0];
    if (!providerKey) return invalidModelFormatResult(model);

    const providerResolution = await resolveModelProviderOrFail(
      providerKey,
      projectId,
    );
    if (!providerResolution.ok) return providerResolution.result;

    const params = await prepareLitellmParams({
      model,
      modelProvider: providerResolution.provider,
      projectId,
    });

    const validationError = validateLitellmParams(params, providerKey);
    if (validationError) return validationError;

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
}

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
    suiteModelFetcher: {
      getBySetId: getSuiteModelOverrides,
    },
    promptFetcher: {
      getPromptByIdOrHandle: (params) =>
        promptService.getPromptByIdOrHandle(params),
    },
    agentFetcher: {
      findById: (params) => agentRepository.findById(params),
    },
    workflowVersionFetcher: {
      getLatestDsl: getLatestWorkflowDsl,
    },
    projectFetcher: {
      findUnique: findProjectApiKey,
    },
    modelResolver: {
      resolve: resolveModelViaFeature,
    },
    projectSecretsFetcher: {
      getSecrets: getDecryptedProjectSecrets,
    },
    modelParamsProvider: {
      prepare: prepareModelParams,
    },
  };
}
