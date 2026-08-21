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
import { parseSuiteTargets } from "../../suites/types";
import {
  mergeRunParameters,
  parseScenarioParameterDefinitions,
  type RunParameterValues,
} from "../parameters";
import { renderScenarioContent } from "./scenario-content-template";
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
import { type FieldMapping, FieldMappingSchema } from "../field-mapping";
import { ScenarioService } from "../scenario.service";
import { resolveTraceWaitTimeoutMs } from "./ingest-lag.service";
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
    /** The parameters the scenario declares, as stored on its JSON column. */
    parameters?: unknown;
    /** Turn config (ADR-015); null = SDK default. */
    maxTurns?: number | null;
    minTurns?: number | null;
  } | null>;
}

/**
 * Resolves run-plan-level (suite) simulator/judge model overrides for a
 * scenario run. The set id encodes the suite (see `getSuiteSetId`), so the
 * prefetcher can pick up a run plan's choices without threading them through
 * the event-sourcing queue. Returns null when the run is not part of a suite.
 */
export interface SuiteConfigFetcher {
  getBySetId(
    setId: string,
    projectId: string,
  ): Promise<{
    simulatorModel: string | null;
    judgeModel: string | null;
    /**
     * The suite's configured targets. Prompt targets carry the bindings from a
     * scenario source to the prompt's declared inputs; agents keep theirs on
     * the agent record. Read through the same set-id lookup as the model
     * overrides, so no binding has to travel through the event queue.
     */
    targets?: Array<{
      type: string;
      referenceId: string;
      scenarioMappings?: Record<string, FieldMapping>;
    }>;
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
  | {
      success: true;
      params: LiteLLMParams;
    }
  | { success: false; reason: ModelParamsFailureReason; message: string };

/** Minimal interface for model params preparation */
export interface ModelParamsProvider {
  prepare(projectId: string, model: string): Promise<ModelParamsResult>;
}

/**
 * Resolves the verdict-time trace wait budget for remote-trace judging from
 * the project's own ingest lag. Only consulted for http targets - the only
 * ones whose judge fetches remote traces.
 */
export interface TraceWaitBudgetResolver {
  resolveTraceWaitTimeoutMs(params: { projectId: string }): Promise<number>;
}

/** All dependencies required by prefetchScenarioData */
export interface DataPrefetcherDependencies {
  scenarioFetcher: ScenarioFetcher;
  suiteConfigFetcher: SuiteConfigFetcher;
  promptFetcher: PromptFetcher;
  agentFetcher: AgentFetcher;
  workflowVersionFetcher: WorkflowVersionFetcher;
  projectFetcher: ProjectFetcher;
  modelParamsProvider: ModelParamsProvider;
  modelResolver: ModelResolver;
  projectSecretsFetcher: ProjectSecretsFetcher;
  traceWaitBudgetResolver: TraceWaitBudgetResolver;
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
 * Everything the child's environment needs, which is a strict subset of a full
 * prefetch and resolves much earlier. See `onChildEnvReady`.
 */
export interface ChildEnvInputs {
  labels: string[];
  telemetry: { endpoint: string; apiKey: string };
}

/**
 * What a prefetch is asked to prepare: the run's execution context, plus the
 * parameter values it resolved.
 *
 * The values travel with the context rather than beside it because they are
 * part of what identifies this run: the same scenario, the same target and the
 * same set can be run again with different ones and be a different run.
 */
export type PrefetchContext = ExecutionContext & {
  /**
   * The values the run resolved for this scenario, as recorded on the queued
   * event. Merged again over the scenario's declared defaults here, which
   * makes the merge idempotent: a job queued by a build that did not resolve
   * them still gets the defaults, and one queued by a build that did gets the
   * same answer twice.
   */
  parameters?: RunParameterValues;
};

/**
 * Pre-fetch all data needed for scenario execution.
 *
 * @param context - Execution context with project/scenario IDs and the run's
 *   resolved parameter values
 * @param target - Target configuration (prompt or http)
 * @param deps - Injected dependencies for data fetching
 * @param onChildEnvReady - Called once, as soon as the scenario and project
 *   resolve, with the only two prefetched values the child's environment
 *   depends on. It exists so the caller can start the child booting against
 *   the rest of this function rather than after it; a caller that does not
 *   care may omit it.
 *
 *   Never called when the run is doomed — a missing scenario, a failed project
 *   lookup or a project with no API key all skip it, so no child is started
 *   for a run that is about to fail.
 */
export async function prefetchScenarioData({
  context,
  target,
  deps,
  onChildEnvReady,
}: {
  context: PrefetchContext;
  target: TargetConfig;
  deps: DataPrefetcherDependencies;
  onChildEnvReady?: (inputs: ChildEnvInputs) => void;
}): Promise<PrefetchResult> {
  logger.debug(
    {
      projectId: context.projectId,
      scenarioId: context.scenarioId,
      batchRunId: context.batchRunId,
      targetType: target.type,
    },
    "Prefetching scenario data",
  );

  // The scenario, the project, the target adapter and the suite config are
  // independent lookups keyed off ids we already hold, so they go out together
  // rather than one await at a time. This runs on the path between a run being
  // queued and its child starting, once per simulation.
  //
  // The checks below keep their original order, so the error reported for any
  // given failure is unchanged; the only difference is that a doomed run may
  // have issued the other queries before finding out.
  const scenarioPromise = fetchScenario({
    projectId: context.projectId,
    scenarioId: context.scenarioId,
    fetcher: deps.scenarioFetcher,
    suppliedParameters: context.parameters,
  });
  const projectPromise = fetchProject(context.projectId, deps.projectFetcher);
  const adapterPromise = fetchAgentData(context.projectId, target, deps);
  const suitePromise = deps.suiteConfigFetcher.getBySetId(
    context.setId,
    context.projectId,
  );

  // The child's environment needs only the scenario's labels and the project's
  // API key, and those two land well before the adapter, suite config and
  // model params. Announcing them here lets the caller start the child booting
  // against the slow half of this function instead of after it — the child is
  // still one fresh process per run, only started sooner.
  //
  // Deliberately not awaited: a failure here is re-reported by the ordered
  // checks below, and this must not become the thing that decides the run.
  if (onChildEnvReady) {
    void Promise.all([scenarioPromise, projectPromise])
      .then(([scenario, project]) => {
        if (!scenario || !project.success || !project.data.apiKey) return;
        onChildEnvReady({
          labels: scenario.config.labels,
          telemetry: {
            endpoint: env.LANGWATCH_ENDPOINT,
            apiKey: project.data.apiKey,
          },
        });
      })
      .catch(() => {
        // Swallowed on purpose: the awaited results below own error reporting.
      });
  }

  const [scenarioResult, projectResult, adapterResult, suiteOverrides] =
    await Promise.all([
      scenarioPromise,
      projectPromise,
      adapterPromise,
      suitePromise,
    ]);

  if (!scenarioResult) {
    logger.warn(
      { projectId: context.projectId, scenarioId: context.scenarioId },
      "Scenario not found",
    );
    return {
      success: false,
      error: `Scenario ${context.scenarioId} not found`,
    };
  }
  const scenario = scenarioResult.config;

  if (!projectResult.success) {
    logger.warn(
      { projectId: context.projectId, error: projectResult.error },
      "Project fetch failed",
    );
    return { success: false, error: projectResult.error };
  }
  const project = projectResult.data;

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
      success: false,
      error: adapterResult.message,
      reason: adapterResult.reason,
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
    const targetLabel =
      target.type === "prompt"
        ? "Prompt"
        : target.type === "code"
          ? "Code agent"
          : target.type === "workflow"
            ? "Workflow agent"
            : "HTTP agent";
    return {
      success: false,
      error: `${targetLabel} ${target.referenceId} not found`,
    };
  }

  // Resolve the model roles a run needs:
  //   - the target adapter, ONLY for a prompt target: the prompt's own
  //     model when set, else the project's scenarios.agent_under_test
  //     DEFAULT-role default. workflow / code / http targets never consume
  //     an LLM key for the agent under test — the workflow/code adapters
  //     send the project's platform API key instead (see
  //     serialized-adapter.registry.ts) and http needs neither — so
  //     resolving and preparing one for them is skipped entirely rather
  //     than risking a project whose FAST/coding default is a
  //     terms-restricted model (issue #6634).
  //   - the user-simulator and the judge: a run-plan override, else the
  //     scenario's own override, else the DEFAULT-role scenarios.user_simulator
  //     / scenarios.judge model. The split lets the role-play and evaluation
  //     use a smart model independently of the agent under test.
  // ModelNotConfiguredError bubbles as a structured "model not configured"
  // failure with the resolver's message.
  // A prompt's bindings are configured on the suite target that paired the
  // prompt with this run plan, so they arrive with the suite rather than with
  // the prompt. Agents carry their own on the agent record, already loaded
  // above.
  if (adapterData.type === "prompt") {
    adapterData.scenarioMappings = suiteOverrides?.targets?.find(
      (candidate) =>
        candidate.type === "prompt" &&
        candidate.referenceId === target.referenceId,
    )?.scenarioMappings;
  }

  let modelForParams: string | undefined;
  let simulatorModel: string;
  let judgeModel: string;
  try {
    if (adapterData.type === "prompt") {
      modelForParams = adapterData.model
        ? adapterData.model
        : await deps.modelResolver.resolve(
            "scenarios.agent_under_test",
            context.projectId,
          );
    }
    simulatorModel =
      suiteOverrides?.simulatorModel ??
      scenarioResult.simulatorModel ??
      (await deps.modelResolver.resolve(
        "scenarios.user_simulator",
        context.projectId,
      ));
    judgeModel =
      suiteOverrides?.judgeModel ??
      scenarioResult.judgeModel ??
      (await deps.modelResolver.resolve("scenarios.judge", context.projectId));
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "No default model configured for this project";
    return { success: false, error: message };
  }

  const [modelParamsResult, simulatorParamsResult, judgeParamsResult] =
    await Promise.all([
      modelForParams !== undefined
        ? deps.modelParamsProvider.prepare(context.projectId, modelForParams)
        : Promise.resolve(undefined),
      deps.modelParamsProvider.prepare(context.projectId, simulatorModel),
      deps.modelParamsProvider.prepare(context.projectId, judgeModel),
    ]);

  if (modelParamsResult && !modelParamsResult.success) {
    logger.warn(
      {
        projectId: context.projectId,
        role: "adapter",
        model: modelForParams,
        reason: modelParamsResult.reason,
      },
      `Failed to prepare model params: ${modelParamsResult.message}`,
    );
    return {
      success: false,
      error: modelParamsResult.message,
      reason: modelParamsResult.reason,
    };
  }
  if (!simulatorParamsResult.success) {
    logger.warn(
      {
        projectId: context.projectId,
        role: "user-simulator",
        model: simulatorModel,
        reason: simulatorParamsResult.reason,
      },
      `Failed to prepare model params: ${simulatorParamsResult.message}`,
    );
    return {
      success: false,
      error: simulatorParamsResult.message,
      reason: simulatorParamsResult.reason,
    };
  }
  if (!judgeParamsResult.success) {
    logger.warn(
      {
        projectId: context.projectId,
        role: "judge",
        model: judgeModel,
        reason: judgeParamsResult.reason,
      },
      `Failed to prepare model params: ${judgeParamsResult.message}`,
    );
    return {
      success: false,
      error: judgeParamsResult.message,
      reason: judgeParamsResult.reason,
    };
  }

  logger.debug(
    {
      projectId: context.projectId,
      scenarioId: context.scenarioId,
      targetType: target.type,
    },
    "Prefetch complete",
  );

  const modelParams = modelParamsResult?.success
    ? modelParamsResult.params
    : undefined;

  // Only an http target's judge fetches remote traces, so only it needs a
  // wait budget. The resolver degrades to a default on any failure, so this
  // never fails the prefetch.
  const traceWaitTimeoutMs =
    target.type === "http"
      ? await deps.traceWaitBudgetResolver.resolveTraceWaitTimeoutMs({
          projectId: context.projectId,
        })
      : undefined;

  return {
    success: true,
    data: {
      context,
      scenario,
      parameters: scenarioResult.parameters,
      adapterData,
      modelParams,
      simulatorModelParams: simulatorParamsResult.params,
      judgeModelParams: judgeParamsResult.params,
      nlpServiceUrl: env.LANGWATCH_NLP_SERVICE,
      target,
      ...(traceWaitTimeoutMs !== undefined ? { traceWaitTimeoutMs } : {}),
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

async function fetchScenario({
  projectId,
  scenarioId,
  fetcher,
  suppliedParameters,
}: {
  projectId: string;
  scenarioId: string;
  fetcher: ScenarioFetcher;
  suppliedParameters?: RunParameterValues;
}): Promise<{
  config: ScenarioConfig;
  parameters: RunParameterValues;
  simulatorModel: string | null;
  judgeModel: string | null;
} | null> {
  const scenario = await fetcher.getById({ projectId, id: scenarioId });
  if (!scenario) return null;

  const definitions = parseScenarioParameterDefinitions(scenario.parameters);
  const parameters = mergeRunParameters({
    definitions,
    values: suppliedParameters,
  });

  const rendered = await renderScenarioContent({
    situation: scenario.situation,
    criteria: scenario.criteria,
    parameters,
    declaredNames: definitions.map((definition) => definition.name),
  });
  if (!rendered.ok) {
    // The request that started this run rendered the same text against the
    // same values and accepted it, so reaching here means the scenario or its
    // parameters changed underneath a queued run. There is nothing the run can
    // do with that, and nothing the customer chose that explains it.
    throw new Error(
      `Scenario ${scenarioId} ${rendered.field} could not be rendered against the run's parameters (${rendered.reason})`,
    );
  }

  return {
    config: {
      id: scenario.id,
      name: scenario.name,
      situation: rendered.situation,
      criteria: rendered.criteria,
      labels: scenario.labels,
      maxTurns: scenario.maxTurns ?? undefined,
      minTurns: scenario.minTurns ?? undefined,
    },
    parameters,
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
    return fetchCodeAgentData(
      projectId,
      target.referenceId,
      deps.agentFetcher,
      deps.projectSecretsFetcher,
    );
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
  return fetchHttpAgentData({
    projectId,
    agentId: target.referenceId,
    fetcher: deps.agentFetcher,
    projectSecretsFetcher: deps.projectSecretsFetcher,
  });
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
    inputs: (prompt.inputs ?? []).map((declared) => ({
      identifier: declared.identifier,
      type: String(declared.type),
    })),
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

async function fetchHttpAgentData({
  projectId,
  agentId,
  fetcher,
  projectSecretsFetcher,
}: {
  projectId: string;
  agentId: string;
  fetcher: AgentFetcher;
  projectSecretsFetcher: ProjectSecretsFetcher;
}): Promise<HttpAgentData | null> {
  const agent = await fetcher.findById({ projectId, id: agentId });
  if (agent?.type !== "http") return null;

  const parseResult = HttpAgentConfigSchema.safeParse(agent.config);
  if (!parseResult.success) {
    return null;
  }
  const config = parseResult.data;

  // Loaded once for the whole run, the same way the code and workflow paths
  // load them: the child process has no database access, so a secret the url,
  // a header or an auth field references has to travel with the job.
  const secrets = await projectSecretsFetcher.getSecrets(projectId);

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
    secrets,
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

async function fetchCodeAgentData(
  projectId: string,
  agentId: string,
  fetcher: AgentFetcher,
  projectSecretsFetcher: ProjectSecretsFetcher,
): Promise<CodeAgentData | null> {
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
  const nodes = Array.isArray(dsl.nodes) ? (dsl.nodes as unknown[]) : [];
  if (nodes.length === 0) return { success: true, dsl };

  // Legacy fallback. `default_llm` only exists on raw persisted DSLs from
  // spec_version <= 1.4 (nodes own their config since 1.5); this reader
  // keeps tolerating it because scenario agents can reference old workflow
  // versions that were never re-saved. On 1.5+ DSLs a modelless llm
  // parameter is stale state and must NOT be silently substituted — leave
  // it unhydrated so the engine raises its typed llm_model_not_set error.
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
  const defaultLlm =
    legacyDsl && typeof dsl.default_llm === "object" && dsl.default_llm !== null
      ? (dsl.default_llm as Record<string, unknown>)
      : null;
  const defaultModel = legacyDsl
    ? typeof defaultLlm?.model === "string" && defaultLlm.model.length > 0
      ? defaultLlm.model
      : DEFAULT_MODEL
    : undefined;

  // Collect unique models needed before hitting the provider
  const modelsNeeded = new Set<string>();
  for (const node of nodes) {
    if (typeof node !== "object" || node === null) continue;
    const n = node as Record<string, unknown>;
    const nodeData =
      typeof n.data === "object" && n.data !== null
        ? (n.data as Record<string, unknown>)
        : null;
    const rawParameters = nodeData?.parameters;
    const parameters = Array.isArray(rawParameters)
      ? (rawParameters as unknown[])
      : [];
    for (const param of parameters) {
      if (typeof param !== "object" || param === null) continue;
      const p = param as Record<string, unknown>;
      if (p.type !== "llm") continue;
      const value =
        typeof p.value === "object" && p.value !== null
          ? (p.value as Record<string, unknown>)
          : null;
      const model =
        typeof value?.model === "string" && value.model.length > 0
          ? value.model
          : defaultModel;
      if (model) modelsNeeded.add(model);
    }
  }

  if (modelsNeeded.size === 0) return { success: true, dsl };

  // Fetch litellm_params for each unique model — fail fast on first failure.
  // Partial hydration is not safe: a partially-hydrated DSL still reaches the
  // NLP service with "dummy" api_key for the un-hydrated nodes.
  const litellmParamsByModel = new Map<string, Record<string, unknown>>();
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

  const hydratedNodes = nodes.map((node) => {
    if (typeof node !== "object" || node === null) return node;
    const n = node as Record<string, unknown>;
    const data =
      typeof n.data === "object" && n.data !== null
        ? (n.data as Record<string, unknown>)
        : null;
    if (!data) return node;

    const parameters = Array.isArray(data.parameters)
      ? (data.parameters as unknown[])
      : null;
    if (!parameters) return node;

    const hydratedParams = parameters.map((param) => {
      if (typeof param !== "object" || param === null) return param;
      const p = param as Record<string, unknown>;
      if (p.type !== "llm") return param;

      const existingValue =
        typeof p.value === "object" && p.value !== null
          ? (p.value as Record<string, unknown>)
          : null;
      const model =
        typeof existingValue?.model === "string" &&
        existingValue.model.length > 0
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
    });

    return { ...n, data: { ...data, parameters: hydratedParams } };
  });

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
    suiteConfigFetcher: {
      getBySetId: async (setId, projectId) => {
        const suiteId = extractSuiteId(setId);
        if (!suiteId) return null;
        const suite = await prisma.simulationSuite.findFirst({
          where: { id: suiteId, projectId },
          select: { simulatorModel: true, judgeModel: true, targets: true },
        });
        if (!suite) return null;
        return {
          simulatorModel: suite.simulatorModel,
          judgeModel: suite.judgeModel,
          targets: parseSuiteTargets(suite.targets),
        };
      },
    },
    promptFetcher: {
      getPromptByIdOrHandle: (params) =>
        promptService.getPromptByIdOrHandle(params),
    },
    agentFetcher: {
      findById: (params) => agentRepository.findById(params),
    },
    workflowVersionFetcher: {
      getLatestDsl: async ({ projectId, workflowId }) => {
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
      },
    },
    projectFetcher: {
      findUnique: async (projectId) =>
        prisma.project.findUnique({
          where: { id: projectId },
          select: { apiKey: true },
        }),
    },
    modelResolver: {
      resolve: async (featureKey, projectId) => {
        const resolved = await resolveModelForFeature(featureKey, {
          prisma,
          projectId,
        });
        return resolved.model;
      },
    },
    traceWaitBudgetResolver: {
      resolveTraceWaitTimeoutMs: (params) => resolveTraceWaitTimeoutMs(params),
    },
    projectSecretsFetcher: {
      getSecrets: async (projectId) => {
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
      },
    },
    modelParamsProvider: {
      prepare: async (projectId, model): Promise<ModelParamsResult> => {
        try {
          if (!model.includes("/")) {
            return {
              success: false,
              reason: "invalid_model_format",
              message: `Invalid model format '${model}' - expected 'provider/model' format (e.g., 'openai/gpt-4')`,
            };
          }

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

          return {
            success: true,
            params: params as LiteLLMParams,
          };
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
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
