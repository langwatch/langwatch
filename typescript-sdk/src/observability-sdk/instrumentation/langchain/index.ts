import type { AgentAction, AgentFinish } from "@langchain/core/agents";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { type DocumentInterface } from "@langchain/core/documents";
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
import type {
  ChatGeneration,
  Generation,
  LLMResult,
} from "@langchain/core/outputs";
import type {
  ChatMessage,
  ChatRichContent,
} from "../../../internal/generated/types/tracer";
import type { ChainValues } from "@langchain/core/utils/types";
import { getLangWatchTracer } from "../../tracer";
import type { LangWatchSpan } from "../../span";
import { context, trace, SpanStatusCode, type Attributes } from "@opentelemetry/api";
import { chatMessageSchema } from "../../../internal/generated/types/tracer.generated";
import { shouldCaptureInput, shouldCaptureOutput } from "../../config";
import { z } from "zod";

export class LangWatchCallbackHandler extends BaseCallbackHandler {
  name = "LangWatchCallbackHandler";
  tracer = getLangWatchTracer("langwatch.instrumentation.langchain");
  spans: Record<string, LangWatchSpan | undefined> = {};

  constructor() {
    super();
  }

  private getParentContext(parentRunId?: string): any {
    if (parentRunId && this.spans[parentRunId]) {
      return trace.setSpan(context.active(), this.spans[parentRunId]);
    }

    return context.active();
  }

  private getSpan(runId: string): LangWatchSpan | undefined {
    return this.spans[runId];
  }

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string  ,
    extraParams?: Record<string, unknown>  ,
    _tags?: string[]  ,
    metadata?: Record<string, unknown>  ,
    name?: string,
  ): Promise<void> {
    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ?? llm.id?.[llm.id.length - 1]?.toString() ?? "llm",
      {},
      parentContext,
    );

    span.setType("llm");

    if (shouldCaptureInput() && prompts) {
      span.setInput(
        "list",
        prompts.map((prompt) => ({ type: "text", value: prompt })),
      );
    }

    if (_tags) {
      span.setAttribute("langwatch.langchain.run.tags", _tags);
    }
    if (extraParams) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(extraParams).map(([key, value]) => [
            [`langwatch.langchain.run.extra_params.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }
    if (metadata) {
      if (metadata.ls_model_name) {
        span.setRequestModel(metadata.ls_model_name as string);
        metadata.ls_model_name = void 0;
      }

      span.setAttributes(
        Object.fromEntries(
          Object.entries(metadata).map(([key, value]) => [
            [`langwatch.langchain.run.metadata.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }
    this.spans[runId] = span;
  }

  async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string  ,
    extraParams?: Record<string, unknown>  ,
    _tags?: string[]  ,
    metadata?: Record<string, unknown>  ,
    name?: string,
  ): Promise<void> {
    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ?? llm.id?.[llm.id.length - 1]?.toString() ?? "chat_model",
      {},
      parentContext,
    );

    span.setType("llm");

    if (shouldCaptureInput()) {
      span.setInput(
        "chat_messages",
        messages.flatMap(convertFromLangChainMessages),
      );
    }

    if (_tags) {
      span.setAttribute("langwatch.langchain.run.tags", _tags);
    }
    if (extraParams) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(extraParams).map(([key, value]) => [
            [`langwatch.langchain.run.extra_params.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }
    if (metadata) {
      if (metadata.ls_model_name) {
        span.setRequestModel(metadata.ls_model_name as string);
        metadata.ls_model_name = void 0;
      }
      span.setAttributes(
        Object.fromEntries(
          Object.entries(metadata).map(([key, value]) => [
            [`langwatch.langchain.run.metadata.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }

    this.spans[runId] = span;
  }

  async handleLLMEnd(
    response: LLMResult,
    runId: string,
    _parentRunId?: string  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    if (shouldCaptureOutput()) {
      const outputs = response.generations.flat().map((generation_) => {
        if ("message" in generation_ && generation_.message) {
          return convertFromLangChainMessages([
            (generation_ as ChatGeneration).message,
          ]);
        } else if ("text" in generation_ && generation_.text) {
          return (generation_).text;
        } else {
          return generation_;
        }
      });

      span.setOutput(outputs);
    }

    addLangChainEvent(span, "handleLLMEnd", runId, _parentRunId);
    span.end();
    this.spans[runId] = void 0;
  }

  async handleLLMError(
    err: Error,
    runId: string,
    _parentRunId?: string  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleLLMError", runId, _parentRunId);

    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.end();
    this.spans[runId] = void 0;
  }

  async handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string  ,
    _tags?: string[]  ,
    _metadata?: Record<string, unknown>  ,
    _runType?: string,
    name?: string,
  ): Promise<void> {
    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ?? chain.id?.[chain.id.length - 1]?.toString() ?? "chain",
      {},
      parentContext,
    );
    span.setType("chain");

    if (shouldCaptureInput()) {
      span.setInput(inputs);
    }

    if (_tags) {
      span.setAttribute("langwatch.langchain.run.tags", _tags);
    }
    if (_metadata) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(_metadata).map(([key, value]) => [
            [`langwatch.langchain.run.metadata.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }
    if (_runType) {
      span.setAttribute("langwatch.langchain.run.type", _runType);
    }

    this.spans[runId] = span;
  }

  async handleChainEnd(
    output: ChainValues,
    runId: string,
    _parentRunId?: string  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleChainEnd", runId, _parentRunId);
    span.setOutput(output);
    span.end();
    this.spans[runId] = void 0;
  }

  async handleChainError(
    err: Error,
    runId: string,
    _parentRunId?: string  ,
    _tags?: string[]  ,
    _kwargs?: { inputs?: Record<string, unknown> | undefined }  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleChainError", runId, _parentRunId);
    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.end();

    this.spans[runId] = void 0;
  }

  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string  ,
    _tags?: string[]  ,
    _metadata?: Record<string, unknown>  ,
    name?: string,
  ): Promise<void> {
    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ?? tool.id?.[tool.id.length - 1]?.toString() ?? "tool",
      {},
      parentContext,
    );
    span.setType("tool");

    if (shouldCaptureInput()) {
      span.setInput("text", input);
    }

    span.setAttributes({
      "langwatch.langchain.run.id": runId,
      "langwatch.langchain.run.parent_id": parentRunId,
    });

    if (_tags) {
      span.setAttribute("langwatch.langchain.run.tags", _tags);
    }
    if (_metadata) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(_metadata).map(([key, value]) => [
            [`langwatch.langchain.run.metadata.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }
    this.spans[runId] = span;
  }

  async handleToolEnd(
    output: string,
    runId: string,
    _parentRunId?: string  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;
    if (shouldCaptureOutput()) {
      span.setOutput("text", output);
    }

    addLangChainEvent(span, "handleToolEnd", runId, _parentRunId);

    span.end();
    this.spans[runId] = void 0;
  }

  async handleToolError(
    err: Error,
    runId: string,
    _parentRunId?: string  ,
    _tags?: string[]  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleToolError", runId, _parentRunId, _tags);

    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.end();
    this.spans[runId] = void 0;
  }

  async handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string  ,
    _tags?: string[]  ,
    _metadata?: Record<string, unknown>  ,
    name?: string  ,
  ) {
    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ??
        retriever.id?.[retriever.id.length - 1]?.toString() ??
        "retriever",
      {},
      parentContext,
    );
    span.setType("rag");

    if (shouldCaptureInput()) {
      span.setInput("text", query);
    }
    if (_tags) {
      span.setAttribute("langwatch.langchain.run.tags", _tags);
    }
    if (_metadata) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(_metadata).map(([key, value]) => [
            [`langwatch.langchain.run.metadata.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }

    span.setAttributes({
      "langwatch.langchain.run.id": runId,
      "langwatch.langchain.run.parent_id": parentRunId,
    });

    this.spans[runId] = span;
  }

  async handleRetrieverEnd(
    documents: DocumentInterface<Record<string, any>>[],
    runId: string,
    _parentRunId?: string  ,
    _tags?: string[]  ,
  ) {
    const span = this.getSpan(runId);
    if (!span) return;
    if (shouldCaptureOutput()) {
      span.setOutput(documents);
    }

    addLangChainEvent(span, "handleRetrieverEnd", runId, _parentRunId, _tags);

    span.setRAGContexts(
      documents.map((document) => ({
        document_id: document.metadata.id,
        chunk_id: document.metadata.chunk_id,
        content: shouldCaptureInput() ? document.pageContent : "",
      })),
    );

    span.end();
    this.spans[runId] = void 0;
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    _parentRunId?: string  ,
    _tags?: string[]  ,
  ) {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleRetrieverError", runId, _parentRunId, _tags);

    span.recordException(err);
    span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    span.end();
    this.spans[runId] = void 0;
  }

  async handleAgentAction(
    _action: AgentAction,
    runId: string,
    _parentRunId?: string  ,
    _tags?: string[]  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleAgentAction", runId, _parentRunId, _tags);
    span.setType("agent");
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    _parentRunId?: string  ,
    _tags?: string[]  ,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleAgentEnd", runId, _parentRunId, _tags);

    if (shouldCaptureOutput()) {
      span.setOutput("json", action.returnValues);
    }

    span.end();
    this.spans[runId] = void 0;
  }
}

export const convertFromLangChainMessages = (
  messages: BaseMessage[],
): ChatMessage[] => {
  const chatMessages: ChatMessage[] = [];
  for (const message of messages) {
    chatMessages.push(
      convertFromLangChainMessage(message as BaseMessage & { id?: string[] }),
    );
  }
  return chatMessages;
};

const convertFromLangChainMessage = (
  message: BaseMessage & { id?: string[] },
): ChatMessage => {
  let role: ChatMessage["role"] = "user";
  const message_: (BaseMessage | StoredMessage) & {
    id?: string[];
    type?: string;
  } = message.lc_serializable
    ? mapChatMessagesToStoredMessages([message])[0]!
    : message;
  if (
    message_ instanceof HumanMessage ||
    message_ instanceof HumanMessageChunk ||
    message_.id?.[message_.id.length - 1] === "HumanMessage" ||
    message_.id?.[message_.id.length - 1] === "HumanMessageChunk" ||
    message_.type === "human"
  ) {
    role = "user";
  } else if (
    message instanceof AIMessage ||
    message instanceof AIMessageChunk ||
    message.id?.[message.id.length - 1] === "AIMessage" ||
    message.id?.[message.id.length - 1] === "AIMessageChunk" ||
    message_.type === "ai"
  ) {
    role = "assistant";
  } else if (
    message instanceof SystemMessage ||
    message instanceof SystemMessageChunk ||
    message.id?.[message.id.length - 1] === "SystemMessage" ||
    message.id?.[message.id.length - 1] === "SystemMessageChunk" ||
    message_.type === "system"
  ) {
    role = "system";
  } else if (
    message instanceof FunctionMessage ||
    message instanceof FunctionMessageChunk ||
    message.id?.[message.id.length - 1] === "FunctionMessage" ||
    message.id?.[message.id.length - 1] === "FunctionMessageChunk" ||
    message_.type === "function"
  ) {
    role = "function";
  } else if (
    message instanceof ToolMessage ||
    message instanceof ToolMessageChunk ||
    message.id?.[message.id.length - 1] === "ToolMessage" ||
    message.id?.[message.id.length - 1] === "ToolMessageChunk" ||
    message_.type === "tool"
  ) {
    role = "tool";
  }

  const content: ChatMessage["content"] =
    typeof message.content === "string"
      ? message.content
      : message.content == null
      ? null
      : Array.isArray(message.content)
      ? message.content.map(
          (content: any): ChatRichContent =>
            content.type === "text"
              ? { type: "text" as const, text: content.text }
              : content.type === "image_url"
              ? { type: "image_url" as const, image_url: content.image_url }
              : { type: "text" as const, text: JSON.stringify(content) },
        )
      : JSON.stringify(message.content);
  const functionCall = message.additional_kwargs as any;

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

function wrapNonScalarValues(
  value: unknown,
): string | number | boolean | undefined {
  if (value === void 0) {
    return void 0;
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  const chatMessages = z.array(chatMessageSchema).safeParse(value);
  if (Array.isArray(value) && chatMessages.success) {
    return JSON.stringify({
      type: "chat_messages",
      value: chatMessages.data,
    });
  }

  try {
    JSON.stringify(value);

    return JSON.stringify({
      type: "json",
      value: value as object,
    });
  } catch (e) {
    // Handle circular references and other serialization errors
    return JSON.stringify({
      type: "raw",
      value: "[Circular Reference or Non-Serializable Object]",
    });
  }
}

function addLangChainEvent(
  span: LangWatchSpan,
  eventName: string,
  runId: string,
  parentRunId: string | undefined,
  tags?: string[]  ,
  metadata?: Record<string, unknown>  ,
  attributes?: Attributes,
) {
  const attrs: Attributes = {
    "langwatch.langchain.run.id": runId,
    "langwatch.langchain.run.parent_id": parentRunId,
    "langwatch.langchain.event.name": eventName,
    ...attributes,
  };

  if (tags) {
    attrs["langwatch.langchain.run.tags"] = tags;
  }
  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      attrs[key] = wrapNonScalarValues(value);
    });
  }

  span.addEvent("langwatch.langchain.callback", attrs);
}
