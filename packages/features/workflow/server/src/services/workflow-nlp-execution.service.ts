import { ValidationError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  customModelEntrySchema,
  filterUnsupportedSamplingParams,
  resolveSupportedParameters,
  type ModelProviderSummary,
  type ModelProviderService,
} from "@langwatch/model-provider-contract";
import {
  getEntryInputs,
  llmConfigSchema,
  migrateDSLVersion,
  type StudioClientEvent,
  type Signature,
  type StudioNode,
  type StudioWorkflow,
  WorkflowExecutionFailedError,
} from "@langwatch/workflow-contract";
import { z } from "zod";
import type {
  WorkflowExecutionInput,
  WorkflowIdPort,
  WorkflowNlpRuntimePort,
} from "../ports/workflow.port";
import type { StudioEventPreparer } from "./studio-event-preparer.service";

const logger = createLogger("langwatch:workflows:execution");

const workflowExecutionResponseSchema = z.object({
  result: z.record(z.string(), z.unknown()).nullable().optional(),
  status: z.enum(["idle", "waiting", "running", "success", "error", "skipped"]),
});

type WorkflowExecutionResponse = z.infer<typeof workflowExecutionResponseSchema>;

type WorkflowNlpExecutionServiceOptions = {
  ids: WorkflowIdPort;
  modelProviders: ModelProviderService;
  nlpRuntime: WorkflowNlpRuntimePort;
  studioEvents: StudioEventPreparer;
};

const workflowExecutionControlsSchema = z.looseObject({
  trace_id: z
    .string()
    .optional()
    .catch(void 0),
  do_not_trace: z
    .boolean()
    .optional()
    .catch(void 0),
});

const looseLlmConfigSchema = llmConfigSchema.passthrough();

function isSignatureNode(
  node: StudioWorkflow["nodes"][number],
): node is StudioNode<Signature> {
  return node.type === "signature";
}

function customModelsForProvider(
  providers: Record<string, ModelProviderSummary>,
  provider: string,
) {
  return (providers[provider]?.customModels ?? []).map((model) =>
    customModelEntrySchema.parse({
      modelId: model.id,
      displayName: model.label,
      mode: model.type === "embedding" ? "embedding" : "chat",
      ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
      ...(model.supportedParameters === undefined
        ? {}
        : { supportedParameters: model.supportedParameters }),
      ...(model.multimodalInputs === undefined
        ? {}
        : { multimodalInputs: model.multimodalInputs }),
    }),
  );
}

function filterLlmConfig(
  providers: Record<string, ModelProviderSummary>,
  value: unknown,
) {
  const parsed = looseLlmConfigSchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }

  const provider = parsed.data.model.split("/")[0];
  const customModels = provider ? customModelsForProvider(providers, provider) : null;

  return filterUnsupportedSamplingParams(
    parsed.data,
    resolveSupportedParameters(parsed.data.model, { customModels }),
  );
}

function stripUnsupportedParams(
  providers: Record<string, ModelProviderSummary>,
  workflow: StudioWorkflow,
): void {
  for (const node of workflow.nodes) {
    if (!isSignatureNode(node)) {
      continue;
    }

    const rootLlm = filterLlmConfig(providers, node.data.llm);
    if (rootLlm) {
      node.data = { ...node.data, llm: rootLlm };
    }

    for (const parameter of node.data.parameters ?? []) {
      if (parameter.identifier !== "llm") {
        continue;
      }

      const value = filterLlmConfig(providers, parameter.value);
      if (value) {
        parameter.value = value;
      }
    }
  }
}

const getWorkflowPayload = (state: StudioWorkflow) => ({
  workflow_id: state.workflow_id,
  spec_version: state.spec_version,
  name: state.name,
  icon: state.icon,
  description: state.description,
  version: state.version,
  enable_tracing: state.enable_tracing,
  nodes: state.nodes,
  edges: state.edges,
  state: state.state,
  template_adapter: state.template_adapter,
  workflow_type: state.workflow_type,
});

const assertRequiredInputs = (
  workflow: StudioWorkflow,
  inputs: Record<string, unknown>,
): void => {
  const inputNames = new Set(Object.keys(inputs));
  const entryInputs = getEntryInputs(workflow.edges, workflow.nodes);

  for (const entry of entryInputs) {
    if (entry.optional) {
      continue;
    }

    const name = entry.sourceHandle?.split(".")[1];
    if (!name || inputNames.has(name)) {
      continue;
    }

    throw new ValidationError(`Missing required input: ${name}`, {
      meta: { input: name },
    });
  }
};

const assertRequiredModelKeys = (
  workflow: StudioWorkflow,
  providers: Record<
    string,
    { provider: string; customKeys: Record<string, unknown> | null }
  >,
): void => {
  const modelsNeeded = workflow.nodes.flatMap((node) => {
    if (!isSignatureNode(node)) {
      return [];
    }

    const values = [
      node.data.llm,
      ...(node.data.parameters ?? [])
        .filter((parameter) => parameter.identifier === "llm")
        .map((parameter) => parameter.value),
    ];

    return values.flatMap((value) => {
      const parsed = looseLlmConfigSchema.safeParse(value);
      if (!parsed.success) {
        return [];
      }

      const provider = parsed.data.model.split("/")[0];
      return provider ? [provider] : [];
    });
  });
  const missingProvider = Object.values(providers).find(
    (provider) => !provider.customKeys && modelsNeeded.includes(provider.provider),
  );
  if (!missingProvider) {
    return;
  }

  throw new ValidationError(
    `Missing required LLM key: ${missingProvider.provider}. Please set the LLM key in the project settings`,
    { meta: { missingKey: missingProvider.provider } },
  );
};

/**
 * Dispatches a version that WorkflowService already resolved through injected
 * process infrastructure. The executor never owns persistence or nlpgo setup.
 */
export class WorkflowNlpExecutionService {
  static create(
    options: WorkflowNlpExecutionServiceOptions,
  ): WorkflowNlpExecutionService {
    return new WorkflowNlpExecutionService(options);
  }

  private constructor(private readonly options: WorkflowNlpExecutionServiceOptions) {}

  async execute(input: WorkflowExecutionInput): Promise<WorkflowExecutionResponse> {
    const workflow = migrateDSLVersion(input.version.dsl);
    const providers = await this.options.modelProviders.getForProject({
      projectId: input.projectId,
    });
    const controls = workflowExecutionControlsSchema.parse(input.inputs);

    assertRequiredInputs(workflow, input.inputs);
    assertRequiredModelKeys(workflow, providers);

    const traceId = controls.trace_id ?? `trace_${this.options.ids.next()}`;
    const origin = input.origin ?? "workflow";
    const event: StudioClientEvent = {
      type: "execute_flow",
      payload: {
        trace_id: traceId,
        workflow: getWorkflowPayload(workflow),
        inputs: [input.inputs],
        manual_execution_mode: false,
        do_not_trace: input.doNotTrace ?? controls.do_not_trace ?? false,
        ...(input.runEvaluations === undefined
          ? {}
          : { run_evaluations: input.runEvaluations }),
        origin,
      },
    };

    try {
      stripUnsupportedParams(providers, event.payload.workflow);
    } catch (error) {
      logger.warn(
        { err: error, projectId: input.projectId, workflowId: input.workflowId },
        "stripUnsupportedLLMParamsFromWorkflow failed; forwarding original payload",
      );
    }

    const response = await this.options.nlpRuntime.dispatch({
      projectId: input.projectId,
      body: await this.options.studioEvents.enrich({
        event,
        projectId: input.projectId,
      }),
      origin,
      causalityDepth: input.causalityDepth,
      parentTrace: input.parentTrace,
    });
    if (!response.ok) {
      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          projectId: input.projectId,
          workflowId: input.workflowId,
        },
        "nlpgo execute_sync returned a non-OK response",
      );
      throw new WorkflowExecutionFailedError();
    }
    return workflowExecutionResponseSchema.parse(await response.json());
  }
}
