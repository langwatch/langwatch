import type { AgentAction, AgentFinish } from "@langchain/core/agents";
import { BaseCallbackHandler } from "@langchain/core/callbacks/base";
import { type DocumentInterface } from "@langchain/core/documents";
import type { Serialized } from "@langchain/core/load/serializable";
import { type BaseMessage } from "@langchain/core/messages";
import type { ChatGeneration, LLMResult } from "@langchain/core/outputs";
import type {
  ChatMessage,
  ChatRichContent,
} from "../../../internal/generated/types/tracer";
import type { ChainValues } from "@langchain/core/utils/types";
import { getLangWatchTracer } from "../../tracer";
import type { LangWatchSpan } from "../../span";
import {
  context,
  trace,
  SpanStatusCode,
  type Attributes,
} from "@opentelemetry/api";
import { chatMessageSchema } from "../../../internal/generated/types/tracer.generated";
import { shouldCaptureInput, shouldCaptureOutput } from "../../config";

type RunKind = "llm" | "chat" | "chain" | "tool" | "retriever";

type StartArgs = {
  kind: RunKind;
  runId: string;
  parentRunId?: string;
  serialized?: Serialized;
  metadata?: Record<string, unknown>;
  tags?: string[];
  name?: string;
  extraParams?: Record<string, unknown>;
  input?: unknown; // already prepared for setInput()
};

const LANGGRAPH_METADATA_KEYS = new Set<string>([
  "thread_id",
  "langgraph_step",
  "langgraph_node",
  "langgraph_triggers",
  "langgraph_path",
  "langgraph_checkpoint_ns",
  "__pregel_task_id",
  "checkpoint_ns",
]);

export class LangWatchCallbackHandler extends BaseCallbackHandler {
  name = "LangWatchCallbackHandler";
  tracer = getLangWatchTracer("langwatch.instrumentation.langchain");

  private spans: Record<string, LangWatchSpan | undefined> = {};
  private parentOf: Record<string, string | undefined> = {};
  private skipped: Record<string, true | undefined> = {};
  private seenStarts = new Set<string>();

  private startRunSpan(args: StartArgs) {
    const { runId, parentRunId, serialized, tags } = args;
    this.parentOf[runId] = parentRunId;

    // if we want to skip, we record as such as we cn do context matching latet
    if (ctxSkip(serialized, tags)) {
      this.skipped[runId] = true;
      return;
    }
    if (this.seenStarts.has(runId)) return;
    this.seenStarts.add(runId);

    const parentCtx = getResolvedParentContext(
      parentRunId,
      this.spans,
      this.parentOf
    );
    const parentSpan = parentRunId ? this.spans[parentRunId] : void 0;
    const links = parentSpan
      ? [{ context: parentSpan.spanContext() }]
      : void 0;

    const { name, type } = deriveNameAndType({
      runType: args.kind,
      name: args.name,
      serialized: args.serialized,
      metadata: args.metadata,
      tags: args.tags,
      inputs: args.input,
    });

    const span = this.tracer.startSpan(name, { links }, parentCtx);
    span.setType(type);

    if (args.tags?.length)
      span.setAttribute("langwatch.langchain.run.tags", args.tags.slice(0, 50));

    if (shouldCaptureInput() && args.input !== void 0) {
      const i: any = args.input as any;
      if (i && typeof i === "object" && "type" in i && "value" in i) {
        span.setInput(i.type, i.value);
      } else {
        span.setInput(i);
      }
    }

    if (args.extraParams) {
      span.setAttributes(
        Object.fromEntries(
          Object.entries(args.extraParams).map(([k, v]) => [
            `langwatch.langchain.run.extra_params.${k}`,
            wrapNonScalarValues(v),
          ])
        )
      );
    }

    if (args.metadata) {
      applyGenAIAttrs(span, args.metadata, args.extraParams);
      setLangGraphAttributes(span, args.metadata);
      span.setAttributes(buildLangChainMetadataAttributes(args.metadata));
    }

    this.spans[runId] = span;
  }

  private finishRun(
    runId: string,
    end: {
      output?: unknown;
      err?: Error;
      event: string;
      parentRunId?: string;
      extra?: Attributes;
      tags?: string[];
      md?: Record<string, unknown>;
    }
  ) {
    const span = this.spans[runId];
    if (!span) return;

    addLangChainEvent(
      span,
      end.event,
      runId,
      end.parentRunId,
      end.tags,
      end.md,
      end.extra
    );

    if (end.err) {
      span.recordException(end.err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: end.err.message });
    } else if (shouldCaptureOutput() && end.output !== undefined) {
      span.setOutput(end.output as any);
    }

    span.end();

    delete this.spans[runId];
    delete this.parentOf[runId];
    delete this.skipped[runId];
    this.seenStarts.delete(runId);
  }

  async handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ): Promise<void> {
    const input = shouldCaptureInput() && prompts
      ? {
          type: "list",
          value: prompts.map((p) => ({ type: "text", value: p })),
        }
      : void 0;

    this.startRunSpan({
      kind: "llm",
      runId,
      parentRunId,
      serialized: llm,
      metadata,
      tags,
      name,
      extraParams,
      input,
    });
  }

  async handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ): Promise<void> {
    const input = shouldCaptureInput()
      ? {
          type: "chat_messages",
          value: messages.flatMap(convertFromLangChainMessages),
        }
      : void 0;

    this.startRunSpan({
      kind: "chat",
      runId,
      parentRunId,
      serialized: llm,
      metadata,
      tags,
      name,
      extraParams,
      input,
    });
  }

  async handleLLMEnd(
    response: LLMResult,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    const span = this.spans[runId];
    const tu = (response.llmOutput as any)?.tokenUsage as
      | {
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        }
      | undefined;
    if (span && tu) {
      span.setAttributes({
        "gen_ai.usage.prompt_tokens": tu.promptTokens ?? 0,
        "gen_ai.usage.completion_tokens": tu.completionTokens ?? 0,
        "gen_ai.usage.total_tokens": tu.totalTokens ?? 0,
      });
    }

    const outputs = shouldCaptureOutput()
      ? response.generations.flat().map((g) => {
          if ("message" in g && g.message) {
            return convertFromLangChainMessages([
              (g as ChatGeneration).message,
            ]);
          } else if ("text" in g && g.text) {
            return g.text;
          }
          return g;
        })
      : undefined;

    this.finishRun(runId, {
      output: outputs,
      event: "handleLLMEnd",
      parentRunId,
    });
  }

  async handleLLMError(
    err: Error,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    this.finishRun(runId, { err, event: "handleLLMError", parentRunId });
  }

  async handleChainStart(
    chain: Serialized,
    inputs: ChainValues,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    _runType?: string,
    name?: string
  ): Promise<void> {
    this.startRunSpan({
      kind: "chain",
      runId,
      parentRunId,
      serialized: chain,
      metadata,
      tags,
      name,
      input: shouldCaptureInput() ? inputs : void 0,
    });

    if (_runType) {
      const span = this.spans[runId];
      if (span) span.setAttribute("langwatch.langchain.run.type", _runType);
    }
  }

  async handleChainEnd(
    output: ChainValues,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    this.finishRun(runId, { output, event: "handleChainEnd", parentRunId });
  }

  async handleChainError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    kwargs?: { inputs?: Record<string, unknown> | undefined }
  ): Promise<void> {
    this.finishRun(runId, {
      err,
      event: "handleChainError",
      parentRunId,
      tags,
      md: kwargs,
    });
  }

  async handleToolStart(
    tool: Serialized,
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ): Promise<void> {
    this.startRunSpan({
      kind: "tool",
      runId,
      parentRunId,
      serialized: tool,
      metadata,
      tags,
      name,
      input: shouldCaptureInput() ? { type: "text", value: input } : void 0,
    });

    const span = this.spans[runId];
    if (span) {
      span.setAttributes({
        "langwatch.langchain.run.id": runId,
        "langwatch.langchain.run.parent_id": parentRunId,
      });
    }
  }

  async handleToolEnd(
    output: string,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    this.finishRun(runId, {
      output: shouldCaptureOutput()
        ? { type: "text", value: output }
        : void 0,
      event: "handleToolEnd",
      parentRunId,
    });
  }

  async handleToolError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    this.finishRun(runId, { err, event: "handleToolError", parentRunId, tags });
  }

  async handleRetrieverStart(
    retriever: Serialized,
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, unknown>,
    name?: string
  ) {
    this.startRunSpan({
      kind: "retriever",
      runId,
      parentRunId,
      serialized: retriever,
      metadata,
      tags,
      name,
      input: shouldCaptureInput() ? { type: "text", value: query } : void 0,
    });

    const span = this.spans[runId];
    if (span) {
      span.setAttributes({
        "langwatch.langchain.run.id": runId,
        "langwatch.langchain.run.parent_id": parentRunId,
      });
    }
  }

  async handleRetrieverEnd(
    documents: DocumentInterface<Record<string, any>>[],
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ) {
    const span = this.spans[runId];

    if (span && shouldCaptureOutput()) {
      span.setOutput(documents);
    }

    if (span && shouldCaptureInput()) {
      span.setRAGContexts(
        documents.map((document) => ({
          document_id: document.metadata.id,
          chunk_id: document.metadata.chunk_id,
          content: document.pageContent,
        }))
      );
    }

    this.finishRun(runId, { event: "handleRetrieverEnd", parentRunId, tags });
  }

  async handleRetrieverError(
    err: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ) {
    this.finishRun(runId, {
      err,
      event: "handleRetrieverError",
      parentRunId,
      tags,
    });
  }

  async handleAgentAction(
    _action: AgentAction,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    const span = this.spans[runId];
    if (span) {
      addLangChainEvent(span, "handleAgentAction", runId, parentRunId, tags);
      span.setType("agent");
    }
  }

  async handleAgentEnd(
    action: AgentFinish,
    runId: string,
    parentRunId?: string,
    tags?: string[]
  ): Promise<void> {
    this.finishRun(runId, {
      output: shouldCaptureOutput()
        ? { type: "json", value: action.returnValues }
        : void 0,
      event: "handleAgentEnd",
      parentRunId,
      tags,
    });
  }
}

export function convertFromLangChainMessages(
  messages: BaseMessage[]
): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const message of messages) {
    out.push(
      convertFromLangChainMessage(message as BaseMessage & { id?: string[] })
    );
  }
  return out;
}

function convertFromLangChainMessage(
  message: BaseMessage & { id?: string[] }
): ChatMessage {
  let role: ChatMessage["role"] = "user";

  const msgType = (message as any).type as string | undefined;
  if (msgType === "human") role = "user";
  else if (msgType === "ai") role = "assistant";
  else if (msgType === "system") role = "system";
  else if (msgType === "function") role = "function";
  else if (msgType === "tool") role = "tool";
  else {
    if (
      (message as any)?._getType?.() === "human" ||
      message.id?.[message.id.length - 1] === "HumanMessage"
    ) {
      role = "user";
    } else if (
      (message as any)?._getType?.() === "ai" ||
      message.id?.[message.id.length - 1] === "AIMessage"
    ) {
      role = "assistant";
    } else if (
      (message as any)?._getType?.() === "system" ||
      message.id?.[message.id.length - 1] === "SystemMessage"
    ) {
      role = "system";
    } else if (
      (message as any)?._getType?.() === "function" ||
      message.id?.[message.id.length - 1] === "FunctionMessage"
    ) {
      role = "function";
    } else if (
      (message as any)?._getType?.() === "tool" ||
      message.id?.[message.id.length - 1] === "ToolMessage"
    ) {
      role = "tool";
    }
  }

  const content: ChatMessage["content"] =
    typeof (message as any).content === "string"
      ? ((message as any).content as string)
      : (message as any).content == null
      ? null
      : Array.isArray((message as any).content)
      ? (message as any).content.map(
          (c: any): ChatRichContent =>
            c?.type === "text"
              ? { type: "text", text: c.text }
              : c?.type === "image_url"
              ? { type: "image_url", image_url: c.image_url }
              : { type: "text", text: JSON.stringify(c) }
        )
      : JSON.stringify((message as any).content);

  const functionCall = (message as any).additional_kwargs;

  return {
    role,
    content,
    ...(functionCall &&
    typeof functionCall === "object" &&
    Object.keys(functionCall).length > 0
      ? { function_call: functionCall }
      : {}),
  };
}

function className(serialized?: Serialized): string {
  const id = (serialized as any)?.id;
  if (Array.isArray(id) && id.length) return String(id[id.length - 1]);
  const ns = (serialized as any)?.lc_namespace;
  if (Array.isArray(ns) && ns.length) return String(ns[ns.length - 1]);

  return "";
}

function shorten(str: string, max = 120): string {
  return typeof str === "string" && str.length > max
    ? str.slice(0, max - 1) + "…"
    : str;
}

function previewInput(v: unknown): string | undefined {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? shorten(s, 120) : void 0;
  }
  return void 0;
}

function ctxSkip(serialized?: Serialized, tags?: string[]) {
  const cls = className(serialized);
  return (
    cls.startsWith("ChannelWrite") ||
    (tags?.includes("langsmith:hidden") ?? false)
  );
}

function wrapNonScalarValues(
  value: unknown
): string | number | boolean | undefined {
  if (value === void 0) return void 0;
  if (value === null) return JSON.stringify(null);
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;

  // Special-case: ChatMessage[] detection via zod schema the project already has
  const chatMessages = chatMessageSchema.array().safeParse(value as any);
  if (Array.isArray(value) && chatMessages.success) {
    return JSON.stringify({ type: "chat_messages", value: chatMessages.data });
  }

  try {
    const seen = new WeakSet();
    const json = JSON.stringify(value as any, (k, val) => {
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]";
        seen.add(val);
      }
      return val;
    });
    return json;
  } catch {
    return JSON.stringify({ type: "raw", value: "[Non-Serializable]" });
  }
}

function addLangChainEvent(
  span: LangWatchSpan,
  eventName: string,
  runId: string,
  parentRunId: string | undefined,
  tags?: string[],
  metadata?: Record<string, unknown>,
  attributes?: Attributes
) {
  const attrs: Attributes = {
    "langwatch.langchain.run.id": runId,
    "langwatch.langchain.run.parent_id": parentRunId,
    "langwatch.langchain.event.name": eventName,
    ...attributes,
  };

  if (tags?.length) attrs["langwatch.langchain.run.tags"] = tags.slice(0, 50);
  if (metadata) {
    Object.entries(metadata).forEach(([key, value]) => {
      attrs[key] = wrapNonScalarValues(value);
    });
  }

  span.addEvent("langwatch.langchain.callback", attrs);
}

function setLangGraphAttributes(
  span: LangWatchSpan,
  metadata?: Record<string, unknown>
) {
  if (!metadata) return;
  const keys = Object.keys(metadata);
  for (const key of keys) {
    const value = (metadata as any)[key];
    if (value !== undefined) {
      const wrapped = wrapNonScalarValues(value);
      if (wrapped !== undefined) {
        span.setAttribute(
          `langwatch.langgraph.${key}` as const,
          wrapped as any
        );
      }
    }
  }
}

function buildLangChainMetadataAttributes(metadata: Record<string, unknown>) {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !LANGGRAPH_METADATA_KEYS.has(key))
      .map(([key, value]) => [
        `langwatch.langchain.run.metadata.${key}`,
        wrapNonScalarValues(value),
      ])
  );
}

function applyGenAIAttrs(
  span: LangWatchSpan,
  metadata?: Record<string, unknown>,
  extraParams?: Record<string, unknown>
) {
  const md = (metadata ?? {}) as any;
  const ex = (extraParams ?? {}) as any;

  const provider = md.ls_provider as string | undefined;
  const requestModel = md.ls_model_name ?? md.kwargs?.model ?? ex.kwargs?.model;
  const temperature =
    md.ls_temperature ?? md.kwargs?.temperature ?? ex.kwargs?.temperature;
  const responseModel = md.response_metadata?.model_name as string | undefined;

  if (provider) span.setAttribute("gen_ai.system", provider);
  if (requestModel) span.setAttribute("gen_ai.request.model", requestModel);
  if (typeof temperature === "number")
    span.setAttribute("gen_ai.request.temperature", temperature);
  if (responseModel) span.setAttribute("gen_ai.response.model", responseModel);
}

function getResolvedParentContext(
  runId: string | undefined,
  spans: Record<string, LangWatchSpan | undefined>,
  parentOf: Record<string, string | undefined>
) {
  let cur = runId;
  while (cur) {
    const s = spans[cur];
    if (s) return trace.setSpan(context.active(), s);
    cur = parentOf[cur];
  }
  return context.active();
}

function deriveNameAndType(opts: {
  runType: RunKind;
  name?: string;
  serialized?: Serialized;
  metadata?: Record<string, unknown>;
  tags?: string[];
  inputs?: unknown;
}): { name: string; type: "llm" | "chain" | "tool" | "rag" | "component" } {
  const { runType, name, serialized, metadata, inputs } = opts;

  // user-specified name / metadata override
  const hardName = (name?.trim() ?? (metadata as any)?.operation_name) as
    | string
    | undefined;
  if (hardName) {
    return {
      name: hardName,
      type:
        runType === "tool"
          ? "tool"
          : runType === "retriever"
          ? "rag"
          : runType === "llm" || runType === "chat"
          ? "llm"
          : "chain",
    };
  }

  const cls = className(serialized);
  const md = (metadata ?? {}) as any;

  // LangGraph node / router - prioritize routers over nodes
  const hasNode = md?.langgraph_node != null;
  const hasTriggers = Array.isArray(md?.langgraph_triggers) && md.langgraph_triggers.length > 0;
  const isRouter =
    cls.startsWith("Branch<") || hasTriggers;
  const isGraphRunner = md?.langgraph_path && !md?.langgraph_node;

  // LLM / Chat - always prioritize runType over metadata
  if (runType === "llm" || runType === "chat") {
    const prov = (md?.ls_provider as string) ?? "LLM";
    const model = (md?.ls_model_name as string) ?? (cls || "call");
    const temp = md?.ls_temperature;
    const tempStr =
      temp != null
        ? typeof temp === "number"
          ? temp.toString()
          : JSON.stringify(temp)
        : null;
    const nm =
      tempStr != null
        ? `${prov} ${model} (temp ${tempStr})`
        : `${prov} ${model}`;
    return { name: nm, type: "llm" };
  }

  // Prioritize LangGraph routers over nodes (but after LLM/Chat)
  if (isRouter) {
    const pathArr = md?.langgraph_path as string[] | undefined;
    const fromNode =
      Array.isArray(pathArr) && pathArr.length
        ? pathArr[pathArr.length - 1]
        : undefined;
    const decision = Array.isArray(md?.langgraph_triggers)
      ? String(
          md.langgraph_triggers.find((t: any) =>
            String(t).startsWith("branch:")
          ) ?? ""
        ).replace(/^branch:(to:)?/, "")
      : undefined;
    const nm = `Route: ${fromNode ?? "unknown"} → ${decision ?? "unknown"}`;
    return { name: nm, type: "component" };
  }

  if (hasNode) {
    const step = md?.langgraph_step;
    const nm = `Node: ${md.langgraph_node}${
      step != null ? ` (step ${String(step)})` : ""
    }`;
    return { name: nm, type: "component" };
  }
  if (isGraphRunner && runType === "chain") {
    return { name: "Graph: LangGraph", type: "chain" };
  }

  // Tool
  if (runType === "tool") {
    const tool = (metadata as any)?.name ?? (cls || "tool");
    const prev =
      previewInput(inputs) ?? previewInput((serialized as any)?.input);
    return {
      name: prev ? `Tool: ${tool} — ${prev}` : `Tool: ${tool}`,
      type: "tool",
    };
  }

  // Retriever
  if (runType === "retriever") return { name: "Retriever", type: "rag" };

  // Fallbacks
  if (cls.includes("Agent"))
    return { name: `Agent: ${cls}`, type: "component" };
  if (cls.startsWith("Runnable"))
    return { name: `Runnable: ${cls.replace(/^Runnable/, "")}`, type: "chain" };
  return { name: cls || "LangChain operation", type: "chain" };
}

// Export helper functions for testing
export {
  className,
  shorten,
  previewInput,
  ctxSkip,
  wrapNonScalarValues,
  addLangChainEvent,
  setLangGraphAttributes,
  buildLangChainMetadataAttributes,
  applyGenAIAttrs,
  getResolvedParentContext,
  deriveNameAndType,
};
