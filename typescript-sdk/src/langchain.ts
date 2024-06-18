import type { AgentAction, AgentFinish } from "@langchain/core/agents";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import type { Serialized } from "@langchain/core/load/serializable";
import {
  AIMessage,
  AIMessageChunk,
  FunctionMessage,
  FunctionMessageChunk,
  HumanMessage,
  HumanMessageChunk,
  SystemMessage,
  SystemMessageChunk,
  ToolMessage,
  ToolMessageChunk,
  mapChatMessagesToStoredMessages,
  type BaseMessage,
  type StoredMessage,
} from "@langchain/core/messages";
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import type { ChainValues } from "@langchain/core/utils/types";
import { type LangWatchSpan, type LangWatchTrace } from ".";
import {
  type BaseSpan,
  type ChatMessage,
  type ChatRichContent,
  type SpanInputOutput,
} from "./types";
import { stringify } from "javascript-stringify";

export class LangWatchCallbackHandler extends BaseCallbackHandler {
  name = "LangWatchCallbackHandler";
  trace: LangWatchTrace;
  spans: Record<string, LangWatchSpan> = {};

  constructor({ trace }: { trace: LangWatchTrace }) {
    super();
    this.trace = trace;
  }

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string | undefined,
    extraParams?: Record<string, unknown> | undefined,
    _tags?: string[] | undefined,
    metadata?: Record<string, unknown> | undefined,
    name?: string
  ): Promise<void> {
    this.spans[runId] = this.buildLLMSpan({
      llm,
      runId,
      parentRunId,
      input: {
        type: "json",
        value: prompts,
      },
      extraParams,
      metadata,
      name,
    });
  }

  private buildLLMSpan({
    llm,
    runId,
    parentRunId,
    input,
    extraParams,
    metadata,
    name,
  }: {
    llm: Serialized;
    runId: string;
    parentRunId?: string | undefined;
    input: SpanInputOutput;
    extraParams?: Record<string, unknown> | undefined;
    metadata?: Record<string, unknown> | undefined;
    name?: string | undefined;
  }) {
    try {
      const parent =
        (parentRunId ? this.spans[parentRunId] : this.trace) ?? this.trace;

      const vendor = metadata?.ls_provider ?? llm.id.at(-2)?.toString();
      const model =
        metadata?.ls_model_name ?? (llm as any).kwargs?.model ?? "unknown";

      const span = parent.startLLMSpan({
        spanId: runId,
        name: name ?? llm.id.at(-1)?.toString(),
        input,
        model: [vendor, model].filter((x) => x).join("/"),
        params: {
          temperature: (extraParams?.invocation_params as any)?.temperature,
          ...((extraParams?.invocation_params as any)?.functions
            ? { functions: (extraParams?.invocation_params as any)?.functions }
            : {}),
        },
      });

      return span;
    } catch (e) {
      this.trace.client.emit("error", e);
      throw e;
    }
  }

  async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string | undefined,
    extraParams?: Record<string, unknown> | undefined,
    tags?: string[] | undefined,
    metadata?: Record<string, unknown> | undefined,
    name?: string
  ): Promise<void> {
    this.spans[runId] = this.buildLLMSpan({
      name,
      llm,
      runId,
      parentRunId,
      input: {
        type: "chat_messages",
        value: messages.flatMap(convertFromLangChainMessages),
      },
      extraParams,
      metadata,
    });
  }

  async handleNewToken(_token: string, runId: string): Promise<void> {
    const span = this.spans[runId];
    if (runId && span && !span.timestamps.firstTokenAt) {
      span.update({
        timestamps: { ...span.timestamps, firstTokenAt: Date.now() },
      });
    }
  }

  async handleLLMEnd(
    response: LLMResult,
    runId: string,
    _parentRunId?: string | undefined
  ): Promise<void> {
    try {
      const span = this.spans[runId];
      if (!span) {
        return;
      }

      const outputs: SpanInputOutput[] = [];
      for (const generation of response.generations) {
        // TODO: again, why the twice loop? Can OpenAI generate multiple chat outputs?
        for (const generation_ of generation) {
          if ("message" in generation_) {
            outputs.push({
              type: "chat_messages",
              value: convertFromLangChainMessages([
                (generation_ as ChatGeneration).message,
              ]),
            });
          } else if ("text" in generation_) {
            outputs.push({
              type: "text",
              value: generation_.text,
            });
          } else {
            outputs.push({
              type: "text",
              value: JSON.stringify(generation_),
            });
          }
        }
      }

      const output: SpanInputOutput | undefined =
        outputs.length === 1
          ? outputs[0]
          : { type: "list", value: outputs as any };

      // Commenting it out because LangChain.js prompt and completion tokens is broken, this one doesn't work as it should with python,
      // and response_metadata.prompt and response_metadata.completion is there but it's always 0. Better let our server count.
      // const metrics = response.llmOutput?.token_usage
      //   ? {
      //       promptTokens: response.llmOutput.token_usage.prompt_tokens,
      //       completionTokens: response.llmOutput.token_usage.completion_tokens,
      //     }
      //   : undefined;

      span.end({
        output,
        // ...(metrics ? { metrics } : {}),
      });
    } catch (e) {
      this.trace.client.emit("error", e);
      throw e;
    }
  }

  async handleLLMError(
    err: Error,
    runId: string,
    _parentRunId?: string | undefined
  ): Promise<void> {
    this.errorSpan({ runId, error: err });
  }

  async handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string | undefined,
    _tags?: string[] | undefined,
    _metadata?: Record<string, unknown> | undefined,
    _runType?: string,
    name?: string
  ): Promise<void> {
    this.spans[runId] = this.buildSpan({
      type: "chain",
      serialized: chain,
      runId,
      parentRunId,
      input: inputs,
      name,
    });
  }

  async handleChainEnd(
    output: ChainValues,
    runId: string,
    _parentRunId?: string | undefined
  ): Promise<void> {
    this.endSpan({
      runId,
      output,
    });
  }

  async handleChainError(
    err: Error,
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined,
    _kwargs?: { inputs?: Record<string, unknown> | undefined } | undefined
  ): Promise<void> {
    this.errorSpan({ runId, error: err });
  }

  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string | undefined,
    _tags?: string[] | undefined,
    _metadata?: Record<string, unknown> | undefined,
    name?: string
  ): Promise<void> {
    this.spans[runId] = this.buildSpan({
      type: "tool",
      serialized: tool,
      runId,
      parentRunId,
      input,
      name,
    });
  }

  async handleToolEnd(
    output: string,
    runId: string,
    _parentRunId?: string | undefined
  ): Promise<void> {
    this.endSpan({ runId, output });
  }

  async handleToolError(
    err: Error,
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined
  ): Promise<void> {
    this.errorSpan({ runId, error: err });
  }

  async handleAgentAction(
    _action: AgentAction,
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined
  ): Promise<void> {
    const span = this.spans[runId];
    if (!span) {
      return;
    }

    span.update({
      type: "agent",
    });
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined
  ): Promise<void> {
    this.endSpan({
      runId,
      output: action.returnValues,
    });
  }

  private buildSpan({
    type,
    serialized,
    runId,
    parentRunId,
    input,
    name,
  }: {
    type: BaseSpan["type"];
    serialized: Serialized;
    runId: string;
    parentRunId?: string | undefined;
    input: unknown;
    name?: string | undefined;
  }) {
    try {
      const parent =
        (parentRunId ? this.spans[parentRunId] : this.trace) ?? this.trace;

      const span = parent.startSpan({
        spanId: runId,
        type,
        name: name ?? serialized.name ?? serialized.id.at(-1)?.toString(),
        input: this.autoconvertTypedValues(input),
      });

      return span;
    } catch (e) {
      this.trace.client.emit("error", e);
      throw e;
    }
  }

  private endSpan({ runId, output }: { runId: string; output: unknown }): void {
    try {
      const span = this.spans[runId];
      if (!span) {
        return;
      }

      span.end({
        output: this.autoconvertTypedValues(output),
      });
    } catch (e) {
      this.trace.client.emit("error", e);
      throw e;
    }
  }

  private errorSpan({ runId, error }: { runId: string; error: Error }): void {
    const span = this.spans[runId];
    if (!span) {
      return;
    }

    span.end({
      error,
    });
  }

  private autoconvertTypedValues(value: any): SpanInputOutput | undefined {
    if (
      !value ||
      (typeof value === "object" && Object.keys(value).length === 0)
    ) {
      return undefined;
    }
    if (typeof value === "string") {
      return { type: "text", value };
    }
    try {
      JSON.stringify(value);
      return { type: "json", value };
    } catch (e) {
      return { type: "text", value: stringify(value) ?? value.toString() };
    }
  }
}

export const convertFromLangChainMessages = (
  messages: BaseMessage[]
): ChatMessage[] => {
  const chatMessages: ChatMessage[] = [];
  for (const message of messages) {
    chatMessages.push(convertFromLangChainMessage(message));
  }
  return chatMessages;
};

const convertFromLangChainMessage = (
  message: BaseMessage & { id?: string[] }
): ChatMessage => {
  let role: ChatMessage["role"] = "user";

  const message_: (BaseMessage | StoredMessage) & {
    id?: string[];
    type?: string;
  } = message.lc_serializable
    ? mapChatMessagesToStoredMessages([message])[0]!
    : message;

  // Dang this is so hard, langchain.js has 3 ways of representing the same thing...
  if (
    message_ instanceof HumanMessage ||
    message_ instanceof HumanMessageChunk ||
    message_.id?.at(-1) === "HumanMessage" ||
    message_.id?.at(-1) === "HumanMessageChunk" ||
    message_.type === "human"
  ) {
    role = "user";
  } else if (
    message instanceof AIMessage ||
    message instanceof AIMessageChunk ||
    message.id?.at(-1) === "AIMessage" ||
    message.id?.at(-1) === "AIMessageChunk" ||
    message_.type === "ai"
  ) {
    role = "assistant";
  } else if (
    message instanceof SystemMessage ||
    message instanceof SystemMessageChunk ||
    message.id?.at(-1) === "SystemMessage" ||
    message.id?.at(-1) === "SystemMessageChunk" ||
    message_.type === "system"
  ) {
    role = "system";
  } else if (
    message instanceof FunctionMessage ||
    message instanceof FunctionMessageChunk ||
    message.id?.at(-1) === "FunctionMessage" ||
    message.id?.at(-1) === "FunctionMessageChunk" ||
    message_.type === "function"
  ) {
    role = "function";
  } else if (
    message instanceof ToolMessage ||
    message instanceof ToolMessageChunk ||
    message.id?.at(-1) === "ToolMessage" ||
    message.id?.at(-1) === "ToolMessageChunk" ||
    message_.type === "tool"
  ) {
    role = "tool";
  }

  const content =
    typeof message.content === "string"
      ? message.content
      : message.content.map(
          (content): ChatRichContent =>
            content.type === "text"
              ? { type: "text", text: content.text }
              : content.type == "image_url"
              ? { type: "image_url", image_url: content.image_url }
              : { type: "text", text: JSON.stringify(content) }
        );

  const functionCall = message.additional_kwargs as
    | ChatMessage["function_call"]
    | undefined;

  return {
    role,
    content,
    ...(functionCall &&
    typeof functionCall === "object" &&
    Object.keys(functionCall).length > 0
      ? { function_call: functionCall }
      : {}),
  };
};
