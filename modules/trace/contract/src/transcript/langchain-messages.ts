import { isRecord } from "./content-format.ts";
import type { ChatMessage } from "./types.ts";

type ToolCall = NonNullable<ChatMessage["tool_calls"]>[number];

/** Roles of LangChain message classes, keyed by the last segment of a dumpd `id`. */
const ROLE_BY_CLASS: Record<string, string> = {
  HumanMessage: "user",
  HumanMessageChunk: "user",
  AIMessage: "assistant",
  AIMessageChunk: "assistant",
  SystemMessage: "system",
  SystemMessageChunk: "system",
  ToolMessage: "tool",
  ToolMessageChunk: "tool",
  FunctionMessage: "function",
  FunctionMessageChunk: "function",
};

/** Roles keyed by a message's own `type` field (`model_dump` and `message_to_dict`). */
const ROLE_BY_TYPE: Record<string, string> = {
  human: "user",
  ai: "assistant",
  system: "system",
  developer: "developer",
  tool: "tool",
  function: "function",
  HumanMessageChunk: "user",
  AIMessageChunk: "assistant",
  SystemMessageChunk: "system",
  ToolMessageChunk: "tool",
  FunctionMessageChunk: "function",
};

const GENERATION_TYPES = new Set([
  "Generation",
  "GenerationChunk",
  "ChatGeneration",
  "ChatGenerationChunk",
]);

const CHAT_MESSAGE_CLASSES = new Set(["ChatMessage", "ChatMessageChunk"]);

function deriveChatMessageRole(fields: Record<string, unknown>): string | null {
  return typeof fields.role === "string" && fields.role.length > 0 ? fields.role : null;
}

function contentOf(value: unknown): ChatMessage["content"] {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return null;
  return value.filter(
    (part): part is Record<string, unknown> | string => typeof part === "string" || isRecord(part),
  );
}

function stringifyArgs(args: unknown): string {
  if (typeof args === "string") return args;
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return "{}";
  }
}

/** LangChain `tool_calls` (`{ name, args, id }`) as OpenAI style function calls. */
function fromLangChainToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((call): ToolCall[] => {
    if (!isRecord(call) || typeof call.name !== "string") return [];
    return [
      {
        id: typeof call.id === "string" ? call.id : "",
        type: "function",
        function: { name: call.name, arguments: stringifyArgs(call.args) },
      },
    ];
  });
}

/** OpenAI style tool calls carried in `additional_kwargs.tool_calls`. */
function fromOpenAiToolCalls(value: unknown): ToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((call): ToolCall[] => {
    if (!isRecord(call) || !isRecord(call.function)) return [];
    const { name, arguments: args } = call.function;
    if (typeof name !== "string") return [];
    return [
      {
        id: typeof call.id === "string" ? call.id : "",
        type: "function",
        function: { name, arguments: stringifyArgs(args) },
      },
    ];
  });
}

function hasToolUseParts(content: ChatMessage["content"]): boolean {
  return (
    Array.isArray(content) && content.some((part) => isRecord(part) && part.type === "tool_use")
  );
}

function toolCallsOf(
  fields: Record<string, unknown>,
  extra: Record<string, unknown>,
  content: ChatMessage["content"],
): ToolCall[] {
  // Anthropic content parts already carry the calls as tool_use blocks.
  if (hasToolUseParts(content)) return [];
  const calls = fromLangChainToolCalls(fields.tool_calls);
  return calls.length > 0 ? calls : fromOpenAiToolCalls(extra.tool_calls);
}

/** A LangChain message's fields (dumpd `kwargs`, `data` or the dump itself) as a chat message. */
function toChatMessage(role: string, fields: Record<string, unknown>): ChatMessage {
  const extra = isRecord(fields.additional_kwargs) ? fields.additional_kwargs : {};
  const content = contentOf(fields.content);
  const message: ChatMessage = { role, content };
  const toolCalls = toolCallsOf(fields, extra, content);
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  if (typeof fields.tool_call_id === "string") message.tool_call_id = fields.tool_call_id;
  if (typeof fields.name === "string" && fields.name.length > 0) message.name = fields.name;
  if (typeof extra.reasoning_content === "string") {
    message.reasoning_content = extra.reasoning_content;
  }
  return message;
}

/** `{"lc": 1, "type": "constructor", "id": [..., "HumanMessage"], "kwargs": {...}}` */
function parseDumpdMessage(obj: Record<string, unknown>): ChatMessage | null {
  if (obj.lc === undefined || obj.type !== "constructor") return null;
  if (!Array.isArray(obj.id) || !isRecord(obj.kwargs)) return null;
  const className = obj.id.at(-1);
  if (typeof className !== "string") return null;
  if (GENERATION_TYPES.has(className)) return parseGeneration({ ...obj.kwargs, type: className });
  const role = CHAT_MESSAGE_CLASSES.has(className)
    ? deriveChatMessageRole(obj.kwargs)
    : ROLE_BY_CLASS[className];
  return role ? toChatMessage(role, obj.kwargs) : null;
}

function deriveRoleOfType(type: unknown, fields: Record<string, unknown>): string | null {
  if (typeof type !== "string") return null;
  if (type === "chat" || CHAT_MESSAGE_CLASSES.has(type)) return deriveChatMessageRole(fields);
  return ROLE_BY_TYPE[type] ?? null;
}

/** `message_to_dict`: `{"type": "human", "data": {"content": ...}}` */
function parseMessageToDict(obj: Record<string, unknown>): ChatMessage | null {
  if (!isRecord(obj.data) || !("content" in obj.data)) return null;
  const role = deriveRoleOfType(obj.type, obj.data);
  return role ? toChatMessage(role, obj.data) : null;
}

/** `model_dump`: `{"type": "human", "content": ..., "additional_kwargs": {}, ...}` */
function parseModelDump(obj: Record<string, unknown>): ChatMessage | null {
  if (!("content" in obj) || "role" in obj) return null;
  if (!("additional_kwargs" in obj) && !("response_metadata" in obj)) return null;
  const role = deriveRoleOfType(obj.type, obj);
  return role ? toChatMessage(role, obj) : null;
}

/** An LLM result generation: `{"type": "ChatGeneration", "message": ..., "text": ...}` */
function parseGeneration(obj: Record<string, unknown>): ChatMessage | null {
  if (typeof obj.type !== "string" || !GENERATION_TYPES.has(obj.type)) return null;
  if (obj.message !== undefined) return parseLangChainMessage(obj.message);
  return typeof obj.text === "string" ? { role: "assistant", content: obj.text } : null;
}

/**
 * A LangChain serialised message (dumpd, `model_dump` or `message_to_dict`)
 * or LLM result generation as a chat message, or null when it is none of those.
 */
export function parseLangChainMessage(item: unknown): ChatMessage | null {
  if (!isRecord(item)) return null;
  return (
    parseDumpdMessage(item) ??
    parseMessageToDict(item) ??
    parseModelDump(item) ??
    parseGeneration(item)
  );
}
