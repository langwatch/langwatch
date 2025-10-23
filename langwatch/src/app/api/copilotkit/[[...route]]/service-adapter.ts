import type {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
  CopilotServiceAdapter,
} from "@copilotkit/runtime";
import { randomUUID } from "@copilotkit/shared";

import { LlmSignatureNodeFactory } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/slices/factories/llm-signature-node.factory";
import type {
  ExecutionState,
  LlmPromptConfigComponent,
  Workflow,
} from "~/optimization_studio/types/dsl";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "~/optimization_studio/types/events";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import { studioBackendPostEvent } from "../../workflows/post_event/post-event";
import type { LLMConfig } from "~/optimization_studio/types/dsl";
import type { ChatMessage } from "~/server/tracer/types";
import type { PromptConfigFormValues } from "~/prompt-configs/types";

type PromptStudioAdapterParams = {
  projectId: string;
};

export class PromptStudioAdapter implements CopilotServiceAdapter {
  private projectId: string;

  constructor(params: PromptStudioAdapterParams) {
    this.projectId = params.projectId;
  }

  /**
   * Process with direct call
   * @param request
   * @returns
   */
  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const {
      eventSource,
      messages,
      forwardedParameters,
      threadId: threadIdFromRequest,
    } = request;

    // @ts-expect-error - Total hack
    const { model, variables: variablesRaw } = forwardedParameters;
    const formValues = JSON.parse(model) as PromptConfigFormValues;
    const variables = variablesRaw
      ? (JSON.parse(variablesRaw as string) as any[])
      : [];
    console.log(model);
    const threadId = threadIdFromRequest ?? randomUUID();
    const nodeId = "prompt_node";
    const traceId = `trace_${randomUUID()}`;
    const workflowId = `prompt_execution_${randomUUID().slice(0, 6)}`;
    const input = this.getLastUserMessageContent(messages) ?? "";

    // Prepend form messages (excluding system) to Copilot messages
    const formMsgs = (formValues.version.configData.messages ?? []).filter(
      (m) => m.role !== "system",
    );
    const messagesHistory = [
      ...formMsgs,
      ...messages.map((message: any) => ({
        role: message.role,
        content: message.content,
      })),
    ];

    const workflow = this.createWorkflow({
      workflowId,
      nodeId,
      formValues,
      messagesHistory,
    });

    // Build execute_flow event (inputs must be an array)
    const rawEvent: StudioClientEvent = {
      type: "execute_component",
      payload: {
        trace_id: traceId,
        workflow,
        node_id: nodeId,
        inputs: variables,
      },
    } as StudioClientEvent;

    // Enrich with envs and datasets to match server route behavior
    const preparedEvent = await loadDatasets(
      await addEnvs(rawEvent, this.projectId),
      this.projectId,
    );

    // Stream workflow server events into CopilotKit runtime events
    void eventSource.stream(async (eventStream$) => {
      let started = false;
      let ended = false;
      const messageId = randomUUID();
      let lastOutput = "";

      const finishIfNeeded = () => {
        if (started && !ended) {
          ended = true;
          eventStream$.sendTextMessageEnd({ messageId });
        }
      };

      try {
        await studioBackendPostEvent({
          projectId: this.projectId,
          message: preparedEvent,
          onEvent: (serverEvent: StudioServerEvent) => {
            if (
              serverEvent.type === "component_state_change" &&
              serverEvent.payload?.component_id === nodeId
            ) {
              const state = serverEvent.payload.execution_state;

              if (!state) return;

              // Start on first state notification
              if (!started) {
                started = true;
                eventStream$.sendTextMessageStart({ messageId });
              }

              const current =
                typeof state.outputs?.output === "string"
                  ? state.outputs.output
                  : undefined;
              if (current && current.length >= lastOutput.length) {
                const delta = current.slice(lastOutput.length);
                if (delta) {
                  eventStream$.sendTextMessageContent({
                    messageId,
                    content: String(delta),
                  });
                }
                lastOutput = current;
              }

              if (state.status === "success" || state.status === "error") {
                finishIfNeeded();
              }
            } else if (serverEvent.type === "error") {
              if (!started) {
                started = true;
                eventStream$.sendTextMessageStart({ messageId });
              }
              const msg = serverEvent.payload?.message ?? "An error occurred";
              eventStream$.sendTextMessageContent({
                messageId,
                content: `❌ ${msg}`,
              });
              finishIfNeeded();
            } else if (serverEvent.type === "done") {
              finishIfNeeded();
            }
          },
        });
      } catch (err: any) {
        if (!started) {
          started = true;
          eventStream$.sendTextMessageStart({ messageId });
        }
        eventStream$.sendTextMessageContent({
          messageId,
          content: `❌ ${err?.message ?? "Unexpected error"}`,
        });
        finishIfNeeded();
      } finally {
        eventStream$.complete();
      }
    });

    return { threadId };
  }

  private getLastUserMessageContent(messages: any[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (
        typeof m?.isTextMessage === "function" &&
        m.isTextMessage() &&
        m.role === "user"
      ) {
        return m.content as string;
      }
    }
    return undefined;
  }

  private createWorkflow(params: {
    workflowId: string;
    nodeId: string;
    formValues: PromptConfigFormValues;
    messagesHistory: ChatMessage[];
  }): Workflow {
    const { workflowId, nodeId, formValues, messagesHistory } = params;
    const nodeData = this.buildNodeData({
      formValues,
      messagesHistory,
    });

    return {
      spec_version: "1.4",
      workflow_id: workflowId,
      name: "Prompt Execution",
      icon: "",
      description: "",
      version: "1.0",
      default_llm: {
        model: formValues.version.configData.llm.model,
        temperature: formValues.version.configData.llm.temperature,
        max_tokens: formValues.version.configData.llm.maxTokens,
      },
      template_adapter: "default",
      enable_tracing: true,
      nodes: [
        {
          ...LlmSignatureNodeFactory.build({
            id: nodeId,
            data: nodeData,
          }),
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      state: { execution: { status: "idle" } },
    };
  }

  private buildNodeData(params: {
    formValues: PromptConfigFormValues;
    messagesHistory: ChatMessage[];
  }): Omit<LlmPromptConfigComponent, "configId"> {
    const { formValues, messagesHistory } = params;
    return {
      name: "LLM Node",
      description: "LLM calling node",
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: formValues.version.configData.llm,
        },
        {
          identifier: "prompting_technique",
          type: "prompting_technique",
          value: formValues.version.configData.promptingTechnique ?? undefined,
        },
        {
          identifier: "instructions",
          type: "str",
          value: formValues.version.configData.prompt ?? "",
        },
        {
          identifier: "messages",
          type: "chat_messages",
          value: messagesHistory,
        },
        {
          identifier: "demonstrations",
          type: "dataset",
          value: formValues.version.configData.demonstrations ?? undefined,
        },
      ],
      inputs: formValues.version.configData.inputs ?? [],
      outputs: formValues.version.configData.outputs,
    };
  }
}
