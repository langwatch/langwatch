import type {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
  CopilotServiceAdapter,
} from "@copilotkit/runtime";
import { randomUUID } from "@copilotkit/shared";

import { LlmSignatureNodeFactory } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/slices/factories/llm-signature-node.factory";
import type {
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
import type { ChatMessage } from "~/server/tracer/types";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import type { runtimeInputsSchema } from "~/prompt-configs/schemas";
import type z from "zod";
import { generateOtelTraceId } from "~/utils/trace";
import { createLogger } from "~/utils/logger";

const logger = createLogger("PromptStudioAdapter");

type PromptStudioAdapterParams = {
  projectId: string;
};

/**
 * Adapter for executing prompt configurations through CopilotKit runtime.
 * Converts prompt form values and variables into workflow execution events,
 * streams LLM responses, and handles errors during execution.
 */
export class PromptStudioAdapter implements CopilotServiceAdapter {
  private projectId: string;

  /**
   * Creates a new PromptStudioAdapter instance.
   * @param params - Configuration parameters including projectId
   */
  constructor(params: PromptStudioAdapterParams) {
    this.projectId = params.projectId;
  }

  /**
   * Processes a chat completion request by executing a prompt workflow and streaming the response.
   * Prepares workflow from form values, executes component, and streams incremental output deltas.
   * @param request - CopilotKit runtime chat completion request containing messages and parameters
   * @returns Promise resolving to chat completion response with threadId
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

    const fallbackThreadId = threadIdFromRequest ?? randomUUID();

    // Try to prepare the workflow; if it fails, stream error to chat
    let preparedEvent: StudioClientEvent;
    let nodeId: string;
    let traceId: string;
    let threadId: string;

    try {
      // @ts-expect-error - Total hack
      const { model: additionalParams } = forwardedParameters;
      const { formValues, variables } = JSON.parse(additionalParams) as {
        formValues: PromptConfigFormValues;
        variables: z.infer<typeof runtimeInputsSchema>;
      };
      threadId = fallbackThreadId;
      nodeId = "prompt_node";
      traceId = generateOtelTraceId();
      const workflowId = `prompt_execution_${randomUUID().slice(0, 6)}`;

      // Prepend form messages (excluding system) to Copilot messages
      const formMsgs = (formValues.version.configData.messages ?? []).filter(
        (m) => m.role !== "system",
      );
      const messagesHistory = [...formMsgs, ...messages]
        .map((message: any) => ({
          role: message.role,
          content: message.content,
        }))
        .filter((message) => message.role !== "system");

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
          enable_tracing: true,
          trace_id: traceId,
          workflow,
          node_id: nodeId,
          inputs: {
            ...variables,
            messages: messagesHistory,
          },
        },
      } as StudioClientEvent;

      // Enrich with envs and datasets to match server route behavior
      preparedEvent = await loadDatasets(
        await addEnvs(rawEvent, this.projectId),
        this.projectId,
      );
    } catch (earlyError: any) {
      logger.error({ earlyError }, "error");
      // Handle errors that occur before streaming starts
      const messageId = generateOtelTraceId();
      void eventSource.stream(async (eventStream$) => {
        eventStream$.sendTextMessageStart({ messageId });
        eventStream$.sendTextMessageContent({
          messageId,
          content: `❌ Configuration Error: ${
            earlyError?.message ?? "Unknown error"
          }`,
        });
        eventStream$.sendTextMessageEnd({ messageId });
        eventStream$.complete();
      });
      return { threadId: fallbackThreadId };
    }

    // Stream workflow server events into CopilotKit runtime events
    void eventSource.stream(async (eventStream$) => {
      let started = false;
      let ended = false;
      const messageId = traceId;
      let lastOutput = "";

      /**
       * Ends the message stream if it was started and not already ended.
       */
      const finishIfNeeded = () => {
        if (started && !ended) {
          ended = true;
          eventStream$.sendTextMessageEnd({ messageId });
        }
      };

      /**
       * Sends an error message to the client and finishes the stream.
       * @param message - Error message to display (without ❌ prefix)
       */
      const sendError = (message: string) => {
        if (!started) {
          started = true;
          eventStream$.sendTextMessageStart({ messageId });
        }
        eventStream$.sendTextMessageContent({
          messageId,
          content: `❌ ${message.replace(/`/g, "'")}`, // Otherwise we'll get code blocks in the message
        });
        finishIfNeeded();
      };

      try {
        await studioBackendPostEvent({
          projectId: this.projectId,
          message: preparedEvent,
          onEvent: (serverEvent: StudioServerEvent) => {
            // Handle component state updates
            if (
              serverEvent.type === "component_state_change" &&
              serverEvent.payload?.component_id === nodeId
            ) {
              const state = serverEvent.payload.execution_state;
              if (!state) return;

              // Initialize stream on first state notification
              if (!started) {
                started = true;
                eventStream$.sendTextMessageStart({
                  messageId,
                });
              }

              // Stream incremental output deltas
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
                    // @ts-expect-error - Total hack
                    traceId,
                  });
                }
                lastOutput = current;
              }

              // Handle completion
              if (state.status === "success") {
                finishIfNeeded();
              }

              // Propagate errors to outer catch
              if (state.error) {
                throw new Error(state.error);
              }
            } else if (serverEvent.type === "error") {
              logger.error({ serverEvent }, "error");
              throw new Error(
                serverEvent.payload?.message ?? "An error occurred",
              );
            } else if (serverEvent.type === "done") {
              finishIfNeeded();
            }
          },
        });
      } catch (err: any) {
        // Centralized error handling: log and stream to client
        logger.error({ err }, "error");
        sendError(err?.message ?? "Unexpected error");
      } finally {
        eventStream$.complete();
      }
    });

    return { threadId };
  }

  /**
   * Creates a workflow definition from prompt configuration and message history.
   * Builds a single-node workflow with LLM signature component for execution.
   * @param params - Workflow configuration including IDs, form values, and messages
   * @returns Complete workflow object ready for execution
   */
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

  /**
   * Builds node data configuration for LLM prompt component from form values.
   * Converts form configuration into component parameters including LLM settings, instructions, and messages.
   * @param params - Form values and message history to convert
   * @returns LLM prompt component configuration without configId
   */
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
          value: messagesHistory.filter((m) => m.role !== "system"),
        },
        {
          identifier: "demonstrations",
          type: "dataset",
          value: formValues.version.configData.demonstrations ?? undefined,
        },
      ],
      inputs: formValues.version.configData.inputs,
      outputs: formValues.version.configData.outputs,
    };
  }
}
