import type {
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
  CopilotServiceAdapter,
} from "@copilotkit/runtime";
import { randomUUID } from "@copilotkit/shared";
import type z from "zod";
import { addEnvs } from "~/optimization_studio/server/addEnvs";
import { loadDatasets } from "~/optimization_studio/server/loadDatasets";
import type {
  LlmPromptConfigComponent,
  Workflow,
} from "~/optimization_studio/types/dsl";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "~/optimization_studio/types/events";
import { LlmSignatureNodeFactory } from "~/optimization_studio/utils/llmSignatureNodeFactory";
import type { runtimeInputsSchema } from "~/prompts/schemas";
import { versionMetadataToNodeFormat } from "~/prompts/schemas/version-metadata-schema";
import type { PromptConfigFormValues } from "~/prompts/types";
import { buildLLMConfig } from "~/server/prompt-config/llmConfigBuilder";
import type { ChatMessage } from "~/server/tracer/types";
import { parseLLMError } from "~/utils/formatLLMError";
import { createLogger } from "~/utils/logger/server";
import { generateOtelTraceId } from "~/utils/trace";
import { studioBackendPostEvent } from "../../workflows/post_event/post-event";
import { extractStreamableOutput, type OutputConfig } from "./output-formatter";

const logger = createLogger("PromptStudioAdapter");

// Matches a `{{ input }}` Liquid placeholder (whitespace tolerated).
// Used to detect whether a saved-prompt template message will absorb
// the live chat turn or needs it appended separately.
const TEMPLATE_INPUT_PLACEHOLDER_RE = /\{\{\s*input\s*\}\}/;

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
    // Allocate traceId first so the error stream and the (potential) backend
    // trace share the same id. Anything that can throw must come after this
    // line — the catch block below relies on it being defined. See #853.
    const traceId = generateOtelTraceId();

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
    let threadId: string;
    let outputConfigs: OutputConfig[] | undefined;

    try {
      // @ts-expect-error - Total hack
      const { model: additionalParams } = forwardedParameters;
      const { formValues, variables } = JSON.parse(additionalParams) as {
        formValues: PromptConfigFormValues;
        variables: z.infer<typeof runtimeInputsSchema>;
      };
      threadId = fallbackThreadId;
      // Capture all output configurations for dynamic field lookup during streaming
      outputConfigs = formValues.version.configData.outputs ?? [
        { identifier: "output", type: "str" },
      ];
      nodeId = "prompt_node";
      const workflowId = `prompt_execution_${randomUUID().slice(0, 6)}`;

      // Prepend form messages (excluding system) to Copilot messages
      const formMsgs = (formValues.version.configData.messages ?? []).filter(
        (m) => m.role !== "system",
      );

      // 2026-05-16 prompt-playground regression: the saved-prompt
      // template carries `{{input}}` placeholders by default
      // (llm-config.repository.ts:872), but PromptStudioAdapter never
      // bound the live chat turn to the `input` variable — so
      // `{{input}}` rendered to empty and the live user message was
      // appended as a SEPARATE turn next to the template turn. Old
      // langwatch_nlp's playground path treated the latest live user
      // message as the `input` value; the new live turn was only
      // appended when the template did NOT already reference
      // `{{input}}`. Reproducing that heuristic here keeps the wire
      // shape (`inputs.input` + `inputs.messages`) consistent with
      // what nlpgo's buildMessages expects and what the saved prompt
      // template assumes.
      const lastLiveUserMsg = [...messages]
        .reverse()
        .find((m: any) => m.role === "user");
      // Broaden the absorb-check to ANY template message (system +
      // user templates), not just user-role templates. Old
      // langwatch_nlp's playground heuristic was 'append the live
      // turn only if `{{input}}` is not in the template' — i.e.
      // ANYWHERE in the template. The 2026-05-17 follow-up to #4087
      // (rchaves dogfood) hit the gap: switching the prompt editor to
      // 'Messages' mode with `{{input}}` ONLY in the system message
      // and a user template like 'answer it' caused the live chat
      // input to be duplicated as a second user turn, because the
      // narrower 'templateUserMsgs only' check returned false.
      const allTemplateMsgs = formValues.version.configData.messages ?? [];
      const templateReferencesInput = allTemplateMsgs.some((m) =>
        TEMPLATE_INPUT_PLACEHOLDER_RE.test(m.content ?? ""),
      );
      // Drop the latest live user turn from the history when ANY
      // template message (system or user) will absorb it through
      // `{{input}}` (otherwise the user sees the same content twice
      // — once via `{{input}}` rendering, once live). Earlier copilot
      // turns (assistant replies + prior user turns) still belong in
      // the history.
      const liveMessagesForHistory =
        templateReferencesInput && lastLiveUserMsg
          ? messages.filter((m: any) => m !== lastLiveUserMsg)
          : messages;
      // Order matters: when the template absorbs the latest live
      // turn via `{{input}}`, the template's `{{input}}`-bearing
      // user slot must land at the END of the messages array so
      // it represents the LATEST turn. Putting formMsgs first
      // shipped `{{input}}` at index 1 right after system, with the
      // actual conversation history pushed behind it — the LLM then
      // saw the latest user turn as if it came BEFORE every prior
      // turn (prod regression: a long history ended up trailing the
      // most recent question). When the template does NOT reference
      // `{{input}}`, formMsgs is preamble/scaffolding (e.g. a fixed
      // `user("answer it")` role-instruction in 'Messages mode') and
      // stays at the front — the live history then appends as normal.
      const messagesHistory = (
        templateReferencesInput && lastLiveUserMsg
          ? [...liveMessagesForHistory, ...formMsgs]
          : [...formMsgs, ...liveMessagesForHistory]
      )
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

      // Convert variables array to dict: { identifier: value }
      // The Python backend expects inputs as Dict[str, Any]
      const variablesDict = (variables ?? []).reduce(
        (acc, v) => {
          if (v.value !== undefined) {
            acc[v.identifier] = v.value;
          }
          return acc;
        },
        {} as Record<string, unknown>,
      );
      // Bind the latest live user message's content to the `input`
      // variable so saved-prompt `{{input}}` placeholders (in system
      // OR template user messages) resolve to what the user actually
      // typed. An explicit non-empty value from the Variables panel
      // always wins — typing-then-overriding is the user's choice.
      //
      // Falsy-check (not `=== undefined`): the saved-prompt template
      // declares `input` as a variable in its `inputs` list, so the
      // form's variablesDict ALWAYS carries an `input` key even when
      // the user hasn't typed anything into the Variables panel — its
      // default is empty-string. A strict-undefined check missed that
      // case and left `input` empty, causing `{{input}}` to render to
      // "" AND the live "test7" turn to be dropped by the absorb step
      // below — exactly the 2026-05-17 prod regression. Treating
      // missing/empty as "panel not set" preserves the user's intent:
      // typing an explicit non-empty value still wins; not typing
      // anything correctly falls back to the chat message.
      const lastLiveUserContent =
        lastLiveUserMsg && typeof (lastLiveUserMsg as any).content === "string"
          ? ((lastLiveUserMsg as any).content as string)
          : undefined;
      if (lastLiveUserContent !== undefined && !variablesDict.input) {
        variablesDict.input = lastLiveUserContent;
      }

      // Build execute_flow event (inputs must be a dict)
      const rawEvent: StudioClientEvent = {
        type: "execute_component",
        payload: {
          enable_tracing: true,
          trace_id: traceId,
          thread_id: threadId,
          workflow,
          node_id: nodeId,
          inputs: {
            ...variablesDict,
            messages: messagesHistory,
          },
          origin: "playground",
        },
      } as StudioClientEvent;

      // Enrich with envs and datasets to match server route behavior
      preparedEvent = await loadDatasets(
        await addEnvs(rawEvent, this.projectId),
        this.projectId,
      );
    } catch (earlyError: any) {
      logger.error(
        { err: earlyError },
        "early error preparing prompt workflow",
      );
      // Use the pre-allocated traceId so the frontend's TraceMessage queries
      // the same id the backend would have used for tracing (issue #853).
      const messageId = traceId;
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
       * @param message - Error message to display
       */
      const sendError = (message: string) => {
        if (!started) {
          started = true;
          eventStream$.sendTextMessageStart({ messageId });
        }
        const parsed = parseLLMError(message);
        // Escape backticks to prevent code blocks in chat
        parsed.message = parsed.message.replace(/`/g, "'");
        eventStream$.sendTextMessageContent({
          messageId,
          content: `[ERROR]${JSON.stringify(parsed)}`,
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

              // Stream incremental output deltas using dynamic field lookup
              const current = extractStreamableOutput(
                state.outputs,
                outputConfigs,
              );
              if (
                current !== undefined &&
                current.length >= lastOutput.length
              ) {
                const delta = current.slice(lastOutput.length);
                if (delta) {
                  eventStream$.sendTextMessageContent({
                    messageId,
                    content: delta,
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
   * Converts form configuration into component parameters including LLM
   * settings, instructions, and messages.
   *
   * Prompt-span parity: when the form originates from a saved prompt
   * (configId / handle / versionMetadata present on the form values),
   * those fields ride along on the dispatched node so nlpgo's engine
   * emits the PromptApiService.get + Prompt.compile span pair with the
   * full identity — the trace drawer's "Open in Prompts" deep-link
   * resolves cleanly back to the playground at the resume target.
   * Fresh ad-hoc prompts (no configId on the form) omit those fields,
   * matching the python-sdk "Create new prompt" path.
   *
   * @param params - Form values and message history to convert
   */
  private buildNodeData(params: {
    formValues: PromptConfigFormValues;
    messagesHistory: ChatMessage[];
  }): LlmPromptConfigComponent {
    const { formValues, messagesHistory } = params;

    // Extract system prompt from messages array
    const messages = formValues.version.configData.messages ?? [];
    const systemMessage = messages.find((msg) => msg.role === "system");
    const systemPrompt = systemMessage?.content ?? "";

    return {
      name: "LLM Node",
      description: "LLM calling node",
      // Pass-through identity fields so nlpgo can stamp the prompt
      // spans. Each is conditional on presence: ad-hoc playground sends
      // omit the keys, mirroring the python-sdk omission convention.
      // versionMetadata uses the canonical form→node converter
      // (versionCreatedAt is a Date in form state, ISO string on the wire).
      ...(formValues.configId !== undefined && {
        configId: formValues.configId,
      }),
      ...(formValues.handle !== undefined && { handle: formValues.handle }),
      ...(formValues.versionMetadata !== undefined && {
        versionMetadata: versionMetadataToNodeFormat(
          formValues.versionMetadata,
        ),
      }),
      parameters: [
        {
          identifier: "llm",
          type: "llm",
          // Use shared buildLLMConfig for consistent camelCase to snake_case conversion
          // and reasoning mapping across all execution entry points
          value: buildLLMConfig(formValues.version.configData.llm),
        },
        {
          identifier: "prompting_technique",
          type: "prompting_technique",
          value: formValues.version.configData.promptingTechnique ?? undefined,
        },
        {
          identifier: "instructions",
          type: "str",
          value: systemPrompt,
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
