import { AbstractAgent, type AgentConfig } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/core";
import { EventType } from "@ag-ui/core";
import { Observable } from "rxjs";
import { generateOtelTraceId } from "~/utils/trace";
import { studioBackendPostEvent } from "../../workflows/post_event/post-event";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "~/optimization_studio/types/events";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import { LlmSignatureNodeFactory } from "~/components/evaluations/wizard/hooks/evaluation-wizard-store/slices/factories/llm-signature-node.factory";
import type { PromptConfigFormValues } from "~/prompt-configs/types";
import type { runtimeInputsSchema } from "~/prompt-configs/schemas";
import type z from "zod";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";

interface PromptExecutionAgentConfig extends AgentConfig {
  projectId: string;
}

/**
 * PromptExecutionAgent
 * Responsibilities:
 * - Execute prompt configurations from prompt studio
 * - Stream LLM responses back to the client
 * - Send trace IDs via agent state messages
 */
export class PromptExecutionAgent extends AbstractAgent {
  private projectId: string;

  constructor(config: PromptExecutionAgentConfig) {
    super({
      agentId: "prompt_execution",
      description: "Executes prompts from prompt studio",
      ...config,
    });
    this.projectId = config.projectId;
  }

  protected run(input: RunAgentInput): Observable<any> {
    return new Observable((subscriber) => {
      const traceId = generateOtelTraceId();
      const nodeId = "prompt_node";

      console.log("PromptExecutionAgent.run - input:", {
        messagesCount: input.messages?.length,
        state: this.state,
        threadId: this.threadId,
        runId: input.runId,
      });

      // MUST emit RUN_STARTED as first event
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: this.threadId,
        runId: input.runId,
      });

      // Extract formValues and variables from the agent state
      const stateData = this.state as {
        formValues: PromptConfigFormValues;
        variables?: z.infer<typeof runtimeInputsSchema>;
      };

      if (!formValues) {
        const { formValues, variables } = JSON.parse(
          // @ts-expect-error - Total hack
          input.forwardedParameters.model,
        );
      }

      console.log("formValues", formValues);
      console.log("variables", variables);
      console.log("input", input);

      // if (!formValues) {
      //   console.error("No formValues in agent state:", this.state);
      //   subscriber.next({
      //     type: EventType.RUN_ERROR,
      //     message: "No formValues provided in agent state",
      //   });
      //   subscriber.complete();
      //   return;
      // }

      // Extract messages from input
      const messagesHistory = (input.messages || [])
        .filter((msg) => msg?.content)
        .map((msg) => ({
          role: msg.role,
          content:
            typeof msg.content === "string"
              ? msg.content
              : JSON.stringify(msg.content),
        }));

      // Build workflow
      const workflow = this.createWorkflow(nodeId, formValues, messagesHistory);

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

      // Process workflow
      void (async () => {
        try {
          const preparedEvent = await loadDatasets(
            await addEnvs(rawEvent, this.projectId),
            this.projectId,
          );

          let lastOutput = "";

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

                const current =
                  typeof state.outputs?.output === "string"
                    ? state.outputs.output
                    : undefined;

                if (current && current.length >= lastOutput.length) {
                  const delta = current.slice(lastOutput.length);
                  if (delta) {
                    subscriber.next({
                      type: EventType.TEXT_MESSAGE_CHUNK,
                      messageId: input.runId,
                      role: "assistant" as const,
                      delta,
                    });
                  }
                  lastOutput = current;
                }

                // Send state snapshot with traceId when done
                if (state.status === "success") {
                  // subscriber.next({
                  //   type: EventType.STATE_SNAPSHOT,
                  //   snapshot: { traceId },
                  // });

                  // Emit RUN_FINISHED on success
                  subscriber.next({
                    type: EventType.RUN_FINISHED,
                    threadId: this.threadId,
                    runId: input.runId,
                  });
                  subscriber.complete();
                } else if (state.status === "error") {
                  // Emit RUN_ERROR on workflow error
                  subscriber.next({
                    type: EventType.RUN_ERROR,
                    message:
                      (state as any).error?.message ?? "Execution failed",
                  });
                  subscriber.complete();
                }
              } else if (serverEvent.type === "error") {
                // Emit RUN_ERROR on server event error
                subscriber.next({
                  type: EventType.RUN_ERROR,
                  message: serverEvent.payload?.message ?? "An error occurred",
                });
                subscriber.complete();
              }
            },
          });
        } catch (error) {
          // Emit RUN_ERROR on exception
          subscriber.next({
            type: EventType.RUN_ERROR,
            message: error instanceof Error ? error.message : "Unknown error",
          });
          subscriber.complete();
        }
      })();
    });
  }

  private createWorkflow(
    nodeId: string,
    formValues: PromptConfigFormValues,
    messagesHistory: any[],
  ) {
    const nodeData: Omit<LlmPromptConfigComponent, "configId"> = {
      name: "LLM Node",
      description: "LLM calling node",
      parameters: [
        {
          identifier: "llm" as const,
          type: "llm" as const,
          value: formValues.version.configData.llm,
        },
        {
          identifier: "prompting_technique" as const,
          type: "prompting_technique" as const,
          value: formValues.version.configData.promptingTechnique ?? undefined,
        },
        {
          identifier: "instructions" as const,
          type: "str" as const,
          value: formValues.version.configData.prompt ?? "",
        },
        {
          identifier: "messages" as const,
          type: "chat_messages" as const,
          value: messagesHistory.filter((m: any) => m.role !== "system"),
        },
        {
          identifier: "demonstrations" as const,
          type: "dataset" as const,
          value: formValues.version.configData.demonstrations ?? undefined,
        },
      ],
      inputs: formValues.version.configData.inputs,
      outputs: formValues.version.configData.outputs,
    };

    return {
      spec_version: "1.4",
      workflow_id: `prompt_execution_${Date.now()}`,
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
          ...LlmSignatureNodeFactory.build({ id: nodeId, data: nodeData }),
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      state: { execution: { status: "idle" } },
    };
  }
}
