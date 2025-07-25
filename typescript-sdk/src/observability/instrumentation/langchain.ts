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
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import type { ChainValues } from "@langchain/core/utils/types";
import { getTracer } from "../trace";
import type { LangWatchSpan } from "../span";
import { context, trace, SpanStatusCode, Attributes } from "@opentelemetry/api";
import { chatMessageSchema } from "../../internal/generated/types/tracer.generated";
import {
  canAutomaticallyCaptureInput,
  canAutomaticallyCaptureOutput,
} from "../../client";
import * as intSemconv from "../semconv";
import { z } from "zod";

export class LangWatchCallbackHandler extends BaseCallbackHandler {
  name = "LangWatchCallbackHandler";
  tracer = getTracer("langwatch.instrumentation.langchain");
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
    parentRunId?: string | undefined,
    extraParams?: Record<string, unknown> | undefined,
    _tags?: string[] | undefined,
    metadata?: Record<string, unknown> | undefined,
    name?: string,
  ): Promise<void> {
    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ?? llm.id?.[llm.id.length - 1]?.toString() ?? "llm",
      {},
      parentContext,
    );

    span.setType("llm");

    if (canAutomaticallyCaptureInput()) {
      span.setInput(prompts);
    }

    if (_tags) {
      span.setAttribute(intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_TAGS, _tags);
    }
    if (extraParams) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(extraParams).map(([key, value]) => [
            [`${intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_EXTRA_PARAMS}.${key}`],
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
            [`${intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_METADATA}.${key}`],
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
    parentRunId?: string | undefined,
    extraParams?: Record<string, unknown> | undefined,
    _tags?: string[] | undefined,
    metadata?: Record<string, unknown> | undefined,
    name?: string,
  ): Promise<void> {
    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ?? llm.id?.[llm.id.length - 1]?.toString() ?? "chat_model",
      {},
      parentContext,
    );

    span.setType("llm");

    if (canAutomaticallyCaptureInput()) {
      span.setInput(messages.flatMap(convertFromLangChainMessages));
    }

    if (_tags) {
      span.setAttribute(intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_TAGS, _tags);
    }
    if (extraParams) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(extraParams).map(([key, value]) => [
            [`${intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_EXTRA_PARAMS}.${key}`],
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
            [`${intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_METADATA}.${key}`],
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
    _parentRunId?: string | undefined,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;
    const outputs: unknown[] = [];
    for (const generation of response.generations) {
      for (const generation_ of generation) {
        if ("message" in generation_ && generation_.message) {
          outputs.push(
            convertFromLangChainMessages([
              (generation_ as ChatGeneration).message,
            ]),
          );
        } else if ("text" in generation_) {
          outputs.push(generation_.text);
        } else {
          outputs.push(JSON.stringify(generation_));
        }
      }
    }
    const output = outputs.length === 1 ? outputs[0] : outputs;

    if (canAutomaticallyCaptureOutput()) {
      span.setOutput(output);
    }

    addLangChainEvent(span, "handleLLMEnd", runId, _parentRunId);
    span.end();
    this.spans[runId] = void 0;
  }

  async handleLLMError(
    err: Error,
    runId: string,
    _parentRunId?: string | undefined,
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
    parentRunId?: string | undefined,
    _tags?: string[] | undefined,
    _metadata?: Record<string, unknown> | undefined,
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

    if (canAutomaticallyCaptureInput()) {
      span.setInput(inputs);
    }

    if (_tags) {
      span.setAttribute(intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_TAGS, _tags);
    }
    if (_metadata) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(_metadata).map(([key, value]) => [
            [`${intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_METADATA}.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }
    if (_runType) {
      span.setAttribute(intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_TYPE, _runType);
    }

    this.spans[runId] = span;
  }

  async handleChainEnd(
    output: ChainValues,
    runId: string,
    _parentRunId?: string | undefined,
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
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined,
    _kwargs?: { inputs?: Record<string, unknown> | undefined } | undefined,
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
    parentRunId?: string | undefined,
    _tags?: string[] | undefined,
    _metadata?: Record<string, unknown> | undefined,
    name?: string,
  ): Promise<void> {
    console.log('a');

    const parentContext = this.getParentContext(parentRunId);
    const span = this.tracer.startSpan(
      name ?? tool.id?.[tool.id.length - 1]?.toString() ?? "tool",
      {},
      parentContext,
    );
    span.setType("tool");

    if (canAutomaticallyCaptureInput()) {
      span.setInputString(input);
    }

    span.setAttributes({
      [intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_ID]: runId,
      [intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_PARENT_ID]: parentRunId,
    });

    if (_tags) {
      span.setAttribute(intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_TAGS, _tags);
    }
    if (_metadata) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(_metadata).map(([key, value]) => [
            [`${intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_METADATA}.${key}`],
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
    _parentRunId?: string | undefined,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;
    if (canAutomaticallyCaptureOutput()) {
      span.setOutputString(output);
    }

    addLangChainEvent(span, "handleToolEnd", runId, _parentRunId);

    span.end();
    this.spans[runId] = void 0;
  }

  async handleToolError(
    err: Error,
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined,
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
    parentRunId?: string | undefined,
    _tags?: string[] | undefined,
    _metadata?: Record<string, unknown> | undefined,
    name?: string | undefined,
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

    if (canAutomaticallyCaptureInput()) {
      span.setInputString(query);
    }
    if (_tags) {
      span.setAttribute(intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_TAGS, _tags);
    }
    if (_metadata) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(_metadata).map(([key, value]) => [
            [`${intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_METADATA}.${key}`],
            wrapNonScalarValues(value),
          ]),
        ),
      );
    }

    span.setAttributes({
      [intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_ID]: runId,
      [intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_PARENT_ID]: parentRunId,
    });

    this.spans[runId] = span;
  }

  async handleRetrieverEnd(
    documents: DocumentInterface<Record<string, any>>[],
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined,
  ) {
    const span = this.getSpan(runId);
    if (!span) return;
    if (canAutomaticallyCaptureOutput()) {
      span.setOutput(documents);
    }

    addLangChainEvent(span, "handleRetrieverEnd", runId, _parentRunId, _tags);

    span.setRAGContexts(
      documents.map((document) => ({
        document_id: document.metadata.id,
        chunk_id: document.metadata.chunk_id,
        content: canAutomaticallyCaptureInput() ? document.pageContent : "",
      })),
    );

    span.end();
    this.spans[runId] = void 0;
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined,
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
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleAgentAction", runId, _parentRunId, _tags);
    span.setType("agent");
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    _parentRunId?: string | undefined,
    _tags?: string[] | undefined,
  ): Promise<void> {
    const span = this.getSpan(runId);
    if (!span) return;

    addLangChainEvent(span, "handleAgentEnd", runId, _parentRunId, _tags);

    if (canAutomaticallyCaptureOutput()) {
      span.setOutput(action.returnValues);
    }

    span.end();
    this.spans[runId] = void 0;
  }
}

export const convertFromLangChainMessages = (
  messages: BaseMessage[],
): any[] => {
  const chatMessages: any[] = [];
  for (const message of messages) {
    chatMessages.push(
      convertFromLangChainMessage(message as BaseMessage & { id?: string[] }),
    );
  }
  return chatMessages;
};

const convertFromLangChainMessage = (
  message: BaseMessage & { id?: string[] },
): any => {
  let role: string = "user";
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
  const content =
    typeof message.content === "string"
      ? message.content
      : message.content.map((content: any) =>
          content.type === "text"
            ? { type: "text", text: content.text }
            : content.type == "image_url"
            ? { type: "image_url", image_url: content.image_url }
            : { type: "text", text: JSON.stringify(content) },
        );
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

function wrapNonScalarValues(value: unknown): string | number | boolean | undefined {
  if (value === void 0) {
    return void 0;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
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
    return JSON.stringify({
      type: "raw",
      value: value as any,
    });
  }
}

function addLangChainEvent(
  span: LangWatchSpan,
  eventName: string,
  runId: string,
  parentRunId: string | undefined,
  tags?: string[] | undefined,
  metadata?: Record<string, unknown> | undefined,
  attributes?: Attributes,
) {
  const attrs: Attributes = {
    [intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_ID]: runId,
    [intSemconv.ATTR_LANGWATCH_LANGCHAIN_RUN_PARENT_ID]: parentRunId,
    [intSemconv.ATTR_LANGWATCH_LANGCHAIN_EVENT_NAME]: eventName,
    ...attributes,
  };

  if (tags) {
    attrs[intSemconv.ATTR_LANGWATCH_LANGCHAIN_TAGS] = tags;
  }
  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      attrs[key] = wrapNonScalarValues(value);
    });
  }

  span.addEvent(intSemconv.EVNT_LANGWATCH_LANGCHAIN_CALLBACK, attrs);
}
