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
import { studioBackendPostEvent } from "../../workflows/post_event/post-event";

const DEFAULT_MODEL = "gpt-4o";

type PromptStudioAdapterParams = {
  projectId: string;
  model?: string;
};

export class PromptStudioAdapter implements CopilotServiceAdapter {
  private projectId: string;
  private model: string;

  constructor(params: PromptStudioAdapterParams) {
    this.projectId = params.projectId;
    this.model = params.model ?? DEFAULT_MODEL;
  }

  async process(
    request: CopilotRuntimeChatCompletionRequest,
  ): Promise<CopilotRuntimeChatCompletionResponse> {
    const {
      eventSource,
      messages,
      forwardedParameters,
      threadId: threadIdFromRequest,
    } = request;

    const threadId = threadIdFromRequest ?? randomUUID();
    const nodeId = "prompt_node";
    const traceId = `trace_${randomUUID()}`;
    const workflowId = `prompt_execution_${randomUUID().slice(0, 6)}`;

    const input = this.getLastUserMessageContent(messages) ?? "";

    const workflow = this.createWorkflow(
      workflowId,
      nodeId,
      forwardedParameters?.model || this.model,
    );
    const event: StudioClientEvent = this.createExecuteComponentEvent(
      traceId,
      workflow,
      nodeId,
      {
        input,
      },
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
          message: event,
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

  private createWorkflow(
    workflowId: string,
    nodeId: string,
    model: string,
  ): Workflow {
    return {
      spec_version: "1.4",
      workflow_id: workflowId,
      name: "Prompt Execution",
      icon: "",
      description: "",
      version: "1.0",
      default_llm: {
        model,
      },
      template_adapter: "default",
      enable_tracing: true,
      nodes: [
        {
          ...LlmSignatureNodeFactory.build({
            id: nodeId,
            data: this.defaultSignatureNodeData(),
          }),
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      state: { execution: { status: "idle" } },
    };
  }

  private defaultSignatureNodeData(): Omit<
    LlmPromptConfigComponent,
    "configId"
  > {
    return {
      name: "LLM Node",
      description: "LLM calling node",
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          value: { model: this.model },
        },
        {
          identifier: "prompting_technique",
          type: "prompting_technique",
          value: undefined,
        },
        {
          identifier: "instructions",
          type: "str",
          value: "You are a helpful assistant.",
        },
        {
          identifier: "messages",
          type: "chat_messages",
          value: [{ role: "user", content: "{{input}}" }],
        },
        {
          identifier: "demonstrations",
          type: "dataset",
          value: {
            inline: {
              records: { input: [], output: [] },
              columnTypes: [
                { name: "input", type: "string" },
                { name: "output", type: "string" },
              ],
            },
          },
        },
      ],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    };
  }

  private createExecuteComponentEvent(
    traceId: string,
    workflow: Workflow,
    nodeId: string,
    inputs: Record<string, string>,
  ): StudioClientEvent {
    return {
      type: "execute_component",
      payload: {
        trace_id: traceId,
        workflow,
        node_id: nodeId,
        inputs,
      },
    } as StudioClientEvent;
  }
}
