import {
  LlmModelNotSetError,
  llmConfigSchema,
  normalizeWorkflowLlmConfig,
  parseStudioWorkflow,
  type LLMConfig,
  type ServerWorkflow,
  type StudioClientEvent,
  type StudioWorkflow,
} from "@langwatch/workflow-contract";
import type {
  WorkflowLlmParameterResolution,
  WorkflowLlmParametersPort,
  WorkflowProjectEnvironmentPort,
} from "../ports/workflow.port";

const workflowLlmConfigSchema = llmConfigSchema.passthrough().nullish();

type StudioWorkflowEventEnricherOptions = {
  projectEnvironment: WorkflowProjectEnvironmentPort;
  llmParameters: WorkflowLlmParametersPort;
};

type WorkflowEvent = Exclude<StudioClientEvent, { type: "is_alive" | "stop_execution" }>;

export type StudioEventEnricher = {
  enrich(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent>;
};

/**
 * Adds runtime project credentials, secrets and LiteLLM parameters to a
 * validated Studio event. Process-specific reads stay behind named ports.
 */
export class StudioWorkflowEventEnricherService implements StudioEventEnricher {
  static create(
    options: StudioWorkflowEventEnricherOptions,
  ): StudioWorkflowEventEnricherService {
    return new StudioWorkflowEventEnricherService(options);
  }

  private constructor(private readonly options: StudioWorkflowEventEnricherOptions) {}

  async enrich(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    const event = input.event;
    if (event.type === "is_alive" || event.type === "stop_execution") {
      return event;
    }

    const { workflow, resolutions } = await this.enrichWorkflow({
      event,
      projectId: input.projectId,
    });
    return this.withWorkflow(event, workflow, resolutions);
  }

  private async enrichWorkflow(input: {
    event: Exclude<StudioClientEvent, { type: "is_alive" | "stop_execution" }>;
    projectId: string;
  }): Promise<{
    workflow: ServerWorkflow;
    resolutions: readonly WorkflowLlmParameterResolution[];
  }> {
    const event = input.event;
    const studioWorkflow = parseStudioWorkflow(event.payload.workflow);
    const workflowId = studioWorkflow.workflow_id;
    if (!workflowId) {
      throw new Error("Workflow ID is required");
    }

    const llmConfigs = this.llmConfigs(event, studioWorkflow.nodes);
    const [environment, resolutions] = await Promise.all([
      this.options.projectEnvironment.get({ projectId: input.projectId }),
      this.options.llmParameters.resolve({
        projectId: input.projectId,
        models: llmConfigs.map((config) => config.llm.model),
      }),
    ]);

    return {
      resolutions,
      workflow: {
        ...studioWorkflow,
        workflow_id: workflowId,
        api_key: environment.apiKey,
        project_id: input.projectId,
        secrets: environment.secrets,
        nodes: await this.enrichNodes(studioWorkflow.nodes, resolutions),
      },
    };
  }

  private async enrichNodes(
    nodes: StudioWorkflow["nodes"],
    resolutions: readonly WorkflowLlmParameterResolution[],
  ): Promise<StudioWorkflow["nodes"]> {
    return Promise.all(
      nodes.map(async (node) => {
        const parameters = await Promise.all(
          node.data.parameters?.map(async (parameter) => {
            if (parameter.type !== "llm") {
              return parameter;
            }
            const llm = workflowLlmConfigSchema.parse(parameter.value);

            return {
              ...parameter,
              value: this.enrichLlm({
                llm,
                nodeName: node.data.name ?? node.id,
                resolutions,
              }),
            };
          }) ?? [],
        );

        return { ...node, data: { ...node.data, parameters } };
      }),
    );
  }

  private withWorkflow(
    event: WorkflowEvent,
    workflow: ServerWorkflow,
    resolutions: readonly WorkflowLlmParameterResolution[],
  ): StudioClientEvent {
    if (event.type === "execute_optimization" && event.payload.params.llm) {
      event.payload.params.llm = this.enrichLlm({
        llm: event.payload.params.llm,
        resolutions,
      });
    }

    return this.attachWorkflow(event, workflow);
  }

  private attachWorkflow<Event extends WorkflowEvent>(
    event: Event,
    workflow: ServerWorkflow,
  ): Event {
    return {
      ...event,
      payload: {
        ...event.payload,
        workflow,
      },
    };
  }

  private llmConfigs(
    event: WorkflowEvent,
    nodes: StudioWorkflow["nodes"],
  ): Array<{ llm: LLMConfig; nodeName?: string }> {
    const parameters: Array<{ llm: LLMConfig; nodeName?: string }> = nodes.flatMap(
      (node) =>
        (node.data.parameters ?? []).flatMap((parameter) => {
          if (parameter.type !== "llm") {
            return [];
          }

          const llm = workflowLlmConfigSchema.parse(parameter.value);
          if (!llm?.model) {
            throw new LlmModelNotSetError(node.data.name ?? node.id);
          }

          return [{ llm, nodeName: node.data.name ?? node.id }];
        }),
    );

    if (event.type === "execute_optimization" && event.payload.params.llm) {
      if (!event.payload.params.llm.model) {
        throw new LlmModelNotSetError();
      }

      parameters.push({ llm: event.payload.params.llm });
    }

    return parameters;
  }

  private enrichLlm(input: {
    llm: LLMConfig | null | undefined;
    nodeName?: string;
    resolutions: readonly WorkflowLlmParameterResolution[];
  }): LLMConfig {
    const llm = input.llm;
    if (!llm?.model) {
      throw new LlmModelNotSetError(input.nodeName);
    }

    const provider = llm.model.split("/")[0]!;
    const resolution = input.resolutions.find((item) => item.model === llm.model);
    if (!resolution || !resolution.configured) {
      throw new Error(`Model provider not configured: ${provider}`);
    }

    if (!resolution.enabled) {
      throw new Error(
        `${provider} model provider is disabled, go to settings to enable it`,
      );
    }

    if (!resolution.litellmParams) {
      throw new Error(`LiteLLM parameters missing for model: ${llm.model}`);
    }

    return {
      ...normalizeWorkflowLlmConfig(llm),
      litellm_params: resolution.litellmParams,
    };
  }
}
