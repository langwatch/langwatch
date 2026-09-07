import type {
  BaseSpan,
  LLMSpan,
  RAGSpan,
  Span,
  SpanInputOutput,
  TypedValueJson,
} from "./trace-format.schemas.ts";

/** A span whose input is worth showing as the trace's first input. */
const hasMeaningfulInput = (span: Span): boolean => {
  if (!span.input?.value) return false;
  if (span.type === "evaluation" || span.type === "guardrail") return false;
  if (span.input.type === "json" && isEmptyJson(span.input.value)) return false;

  // Agent inputs captured by openinference from agno are not really human redable, skip it
  return !(
    span.params?.scope?.name === "openinference.instrumentation.agno" && span.type === "agent"
  );
};

/** Haystack wraps a pipeline's input in `{ data: { <component>: ... } }`. */
const findHaystackInput = (span: Span | undefined): SpanInputOutput | undefined => {
  if (span?.type !== "chain") return undefined;
  if (!span.params?.scope?.name?.includes("haystack")) return undefined;
  const data = (span.input?.value as any)?.data;
  if (typeof data !== "object") return undefined;

  return { type: "json", value: Object.values(data)[0] as any };
};

/** What a trace with no readable input is called: its request line, or the topmost span's name. */
const describeInputlessTrace = (topmostSpans: Span[]): string => {
  const topmostSpan = topmostSpans.filter((span) => !span.parent_id)[0];
  if (topmostSpan?.params?.http?.method && topmostSpan?.params?.http?.target) {
    return `${topmostSpan?.params?.http?.method} ${topmostSpan?.params?.http?.target}`;
  }

  return topmostSpan?.name ?? "";
};

export const getFirstInputAsText = (spans: Span[]): string => {
  const topmostSpans = flattenSpanTree(organizeSpansIntoTree(spans), "outside-in");
  const topmostInputs = topmostSpans.filter(hasMeaningfulInput);

  const input = findHaystackInput(topmostSpans[0]) ?? topmostInputs[0]?.input;
  if (!input) return describeInputlessTrace(topmostSpans);

  const text = typedValueToText(input, true, "user");
  if (!text && topmostInputs[0]?.name?.startsWith("RunnableSequence") && topmostInputs[1]?.input) {
    return typedValueToText(topmostInputs[1].input, true, "user");
  }

  return text;
};

export const isEmptyJson = (value: TypedValueJson["value"]): boolean => {
  let isEmpty =
    !value ||
    value === "null" ||
    value === "{}" ||
    (typeof value === "object" && Object.keys(value).length === 0);

  if (
    !isEmpty &&
    typeof value === "object" &&
    value &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1
  ) {
    const value_ = value[Object.keys(value)[0]!];
    isEmpty = isEmptyJson(value_);
  }

  return isEmpty;
};

export const getLastOutputAsText = (spans: Span[]): string => {
  const nonEmptySpan = (span: Span) =>
    span.output?.value &&
    span.type !== "evaluation" &&
    span.type !== "guardrail" &&
    (span.output.type !== "json" || !isEmptyJson(span.output.value));

  // First we try to see if the topLevel node has a valid output, if so, we go with that, so users
  // can take control of which output to use by controlling the top level one by hand, even if it
  // doesn't finish last because of some background process span being captured
  // `.reverse()` on a fresh array rather than `.toReversed()`: the packaged
  // build targets an `es2022` library, and the copy is what the method does.
  const topLevelNodes = flattenSpanTree(organizeSpansIntoTree(spans), "inside-out")
    .filter(nonEmptySpan)
    .reverse();
  const singleTopLevelNode = topLevelNodes.length === 1 ? topLevelNodes[0] : undefined;

  if (singleTopLevelNode?.output) {
    return typedValueToText(singleTopLevelNode.output, true);
  }

  // If the top-level node has no output, then for getting the best text that represents the
  // output, we try to find the last span to finish, this is likely the one that came up with
  // the final answer.
  const spansInFinishOrderDesc = [...spans]
    .sort(
      (a: (typeof spans)[number], b: (typeof spans)[number]) =>
        b.timestamps.finished_at - a.timestamps.finished_at,
    )
    .filter(nonEmptySpan);

  for (const span of spansInFinishOrderDesc) {
    if (!span.output) continue;
    const text = typedValueToText(span.output, true);
    if (text) {
      return text;
    }
  }

  const topmostSpan = flattenSpanTree(organizeSpansIntoTree(spans), "outside-in").filter(
    (span) => !span.parent_id,
  )[0];
  if (topmostSpan?.params?.http?.status_code) {
    return topmostSpan.params.http.status_code.toString();
  }
  return "";
};

/**
 * Extract text from a content block, handling both OpenAI/Anthropic style
 * ({type:"text", text:"..."}) and pi-ai/Vercel AI SDK style ({type:"text", content:"..."}).
 */
const textFromContentBlock = (c: any): string => {
  if ("text" in c && typeof c.text === "string") return c.text;
  if ("content" in c && typeof c.content === "string") return c.content;
  return JSON.stringify(c);
};

/**
 * Get the content array from a message, checking both `content` and `parts`
 * fields (Vercel AI SDK / pi-ai use `parts` instead of `content`).
 */
const getMessageContent = (message: any): unknown => {
  return message.content ?? message.parts;
};

/**
 * The text of the LAST message in a chat-messages-shaped array, preferring
 * the last one from `preferRole` if given.
 */
const extractLastMessageText = (json: any[], preferRole?: string): string => {
  const preferredMessage = preferRole
    ? [...json].reverse().find((m: any) => m?.role === preferRole)
    : undefined;
  const lastMessage = preferredMessage ?? json[json.length - 1];
  const content = getMessageContent(lastMessage);
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map(textFromContentBlock).join("");
  }
  return lastMessage ? JSON.stringify(lastMessage) : "";
};

const stringified = (value_: any) => {
  if (typeof value_ === "string") {
    return value_;
  }
  try {
    return JSON.stringify(value_);
  } catch {
    return value_.toString();
  }
};

/** One message's text: its string content, its content blocks joined, or the message itself. */
const messageContentToText = (content: unknown, message: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(textFromContentBlock).join("");

  return JSON.stringify(message);
};

const chatMessagesToText = (messages: any[], last: boolean): string => {
  if (last) {
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage) return "";

    return messageContentToText(getMessageContent(lastMessage), lastMessage);
  }

  return messages
    .map((message) => {
      const content = getMessageContent(message);
      return content ?? JSON.stringify(message);
    })
    .join("");
};

// A candidate value is "meaningful" when it's defined and not an empty string/array/object
// — applied RECURSIVELY so a shell like `{ output: { content: "" } }` is treated as empty
// at the top-level special-key check, letting the loop fall through to the next sibling key
// (e.g. `answer`). Without recursion, any object with keys short- circuited
// specialKeysMapping and the real payload on the next key was never seen.
const hasNonEmptyValue = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.length > 0;
  if (typeof value === "object") {
    if (seen.has(value)) return false;
    seen.add(value);
    const values = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    return values.some((item) => hasNonEmptyValue(item, seen));
  }

  return true;
};

/** The keys that carry a trace's text, in the order the first non-empty one wins. */
const SPECIAL_TEXT_KEYS = [
  "text",
  "input",
  "question",
  "user_query",
  "query",
  "message",
  // Langflow
  "input_value",
  "output",
  "answer",
  // Chainlit
  "content",
  // Haystack
  "prompt",
] as const;

const readSpecialTextKey = (json: any): string | undefined => {
  for (const key of SPECIAL_TEXT_KEYS) {
    if (!hasNonEmptyValue(json[key])) continue;
    // `message` is only taken when it is the text itself, not a message object.
    if (key === "message" && typeof json.message !== "string") continue;

    return json[key];
  }

  return undefined;
};

/** Langgraph on Flowise, and LangChain's agent return values. */
const readFlowiseMessages = (json: any): string | undefined => {
  if (
    json.messages?.length > 0 &&
    hasNonEmptyValue(json.messages?.[json.messages?.length - 1]?.content)
  ) {
    return json.messages[json.messages?.length - 1].content;
  }
  if (hasNonEmptyValue(json.return_values?.output)) {
    return json.return_values.output;
  }

  return undefined;
};

const LANGCHAIN_INPUT_KEYS = ["input", "text", "query", "question"] as const;

// LangChain
// NOTE: we intentionally keep the old `!== undefined` check (not hasNonEmptyValue)
// for the `inputs`/`outputs` wrapper paths. `RunnableSequence` legitimately produces
// `{ inputs: { input: "" } }` and the caller (getFirstInputAsText) relies on the
// returned "" to trigger a fallback to the next span in the sequence.
const readLangChainWrapper = (json: any): string | undefined => {
  if (typeof json.inputs === "object") {
    for (const key of LANGCHAIN_INPUT_KEYS) {
      if (json.inputs[key] !== undefined) return json.inputs[key];
    }
  }
  if (typeof json.outputs === "object" && json.outputs.output !== undefined) {
    return json.outputs.output;
  }
  if (typeof json.outputs === "string") {
    return json.outputs;
  }
  if (typeof json.outputs === "object" && json.outputs.text !== undefined) {
    return json.outputs.text;
  }
  if (Array.isArray(json.llm?.replies)) {
    return json.llm.replies[0];
  }

  return undefined;
};

/** Langgraph.js keeps the answer on the last `AIMessage`'s kwargs. */
const readLanggraphMessage = (json: any): string | undefined => {
  if (
    Array.isArray(json.messages) &&
    Array.isArray(json.messages.at(-1)?.id) &&
    json.messages.at(-1)?.id.includes("AIMessage") &&
    json.messages.at(-1)?.kwargs?.content
  ) {
    return json.messages.at(-1)?.kwargs?.content;
  }

  return undefined;
};

const specialKeysMapping = (json: any): string | undefined => {
  const direct = readSpecialTextKey(json);
  if (direct !== undefined) return direct;

  const flowise = readFlowiseMessages(json);
  if (flowise !== undefined) return flowise;

  const langchain = readLangChainWrapper(json);
  if (langchain !== undefined) return langchain;

  const langgraph = readLanggraphMessage(json);
  if (langgraph !== undefined) return langgraph;

  // Optimization Studio
  if (json.end !== undefined) {
    return specialKeysMapping(json.end) ?? json.end;
  }

  return undefined;
};

const firstAndOnlyKey = (json: any) => {
  if (typeof json === "object" && !Array.isArray(json) && Object.keys(json).length === 1) {
    const firstItem = json[Object.keys(json)[0]!];
    const mapped = typeof firstItem === "object" ? specialKeysMapping(firstItem) : undefined;
    if (mapped !== undefined) {
      return stringified(mapped);
    }

    return stringified(firstItem);
  }

  return undefined;
};

// Handle arrays that look like chat messages (objects with "role" property)
// This covers cases where validation doesn't match chat_messages due to
// non-standard roles like "toolResult"
const looksLikeChatMessages = (json: any): boolean =>
  Array.isArray(json) &&
  json.length > 0 &&
  typeof json[0] === "object" &&
  json[0] !== null &&
  "role" in json[0];

const roleArrayToText = (json: any[], last: boolean, preferRole: string | undefined): string => {
  if (last) return extractLastMessageText(json, preferRole);

  return json
    .map((message: any) => messageContentToText(getMessageContent(message), message))
    .join("");
};

const mapJsonValue = (json: any): string | undefined => {
  if (Array.isArray(json) && json.length === 1) {
    return typeof json[0] === "string" ? json[0] : specialKeysMapping(json[0]);
  }

  return specialKeysMapping(json);
};

const jsonToText = (value: unknown, last: boolean, preferRole: string | undefined): string => {
  try {
    const json = value as any;
    if (looksLikeChatMessages(json)) return roleArrayToText(json, last, preferRole);

    const mapped = mapJsonValue(json);
    if (mapped !== undefined) {
      return firstAndOnlyKey(mapped) ?? stringified(mapped);
    }

    return firstAndOnlyKey(json) ?? stringified(json);
  } catch {
    return (value as any)?.toString() ?? "";
  }
};

const listToText = (value: unknown, last: boolean, preferRole: string | undefined): string => {
  if (!Array.isArray(value) || value.length === 0) return "";

  const item = last ? value[value.length - 1] : value[0];
  // Only recurse into structured SpanInputOutput items (have "type" and "value").
  // Non-structured list items (primitives, arbitrary objects) cannot be
  // meaningfully represented as text and are intentionally ignored.
  if (item && typeof item === "object" && "type" in item && "value" in item) {
    return typedValueToText(item as SpanInputOutput, last, preferRole);
  }

  return "";
};

export const typedValueToText = (
  typed: SpanInputOutput,
  last = false,
  preferRole?: string,
): string => {
  switch (typed.type) {
    case "text":
      return typed.value;
    case "chat_messages":
      return chatMessagesToText(typed.value, last);
    case "json":
      return jsonToText(typed.value, last, preferRole);
    case "list":
      return listToText(typed.value, last, preferRole);
    case "raw":
      return stringified(typed.value);
    default:
      return "";
  }
};

interface BaseSpanWithChildren extends BaseSpan {
  children: SpanWithChildren[];
}
interface LLMSpanWithChildren extends LLMSpan {
  children: SpanWithChildren[];
}
interface RAGSpanWithChildren extends RAGSpan {
  children: SpanWithChildren[];
}
export type SpanWithChildren = BaseSpanWithChildren | LLMSpanWithChildren | RAGSpanWithChildren;

export const organizeSpansIntoTree = (spans: Span[]): SpanWithChildren[] => {
  const spanMap = new Map<string, SpanWithChildren>();

  // Sort based on started_at timestamp, so that all siblings are in started_at order
  const sortedSpans = [...spans].sort((a, b) => a.timestamps.started_at - b.timestamps.started_at);

  // Initialize each span with an empty children array
  sortedSpans.forEach((span) => {
    spanMap.set(span.span_id, { ...span, children: [] });
  });

  // Assign children to their respective parents
  sortedSpans.forEach((span) => {
    if (span.parent_id && spanMap.has(span.parent_id)) {
      spanMap.get(span.parent_id)!.children.push(spanMap.get(span.span_id)!);
    }
  });

  // Extract top-level spans (those without a parent_id or with a non-existent parent_id)
  return Array.from(spanMap.values()).filter(
    (span) => !span.parent_id || !spanMap.has(span.parent_id),
  );
};

export const flattenSpanTree = (
  spans: SpanWithChildren[],
  mode: "inside-out" | "outside-in",
): Span[] => {
  const result: Span[] = [];

  const appendSpans = (nodeSpans: SpanWithChildren[]) => {
    nodeSpans.forEach((span) => {
      const spanWithoutChildren: Span = { ...span };
      //@ts-expect-error: `children` only exists on SpanWithChildren, and is being dropped here
      delete spanWithoutChildren.children;
      result.push(spanWithoutChildren);
    });
  };

  const traverseAndCollect = (nodeSpans: SpanWithChildren[]) => {
    if (mode === "outside-in") {
      appendSpans(nodeSpans);
    }

    nodeSpans.forEach((span) => {
      if (span.children && span.children.length > 0) {
        traverseAndCollect(span.children);
      }
    });

    if (mode === "inside-out") {
      appendSpans(nodeSpans);
    }
  };

  traverseAndCollect(spans);

  return result;
};
