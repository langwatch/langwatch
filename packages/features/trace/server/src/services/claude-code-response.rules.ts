import { z } from "zod";
import { asNumber } from "./canonical-guard.rules";
import { capPayloadString } from "./trace-payload-cap.rules";

const responseContentBlockSchema = z.looseObject({
  type: z.string().optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
});

const responseBodySchema = z.looseObject({
  content: z.array(responseContentBlockSchema).optional(),
  usage: z
    .looseObject({
      cache_creation: z
        .looseObject({
          ephemeral_5m_input_tokens: z.unknown().optional(),
          ephemeral_1h_input_tokens: z.unknown().optional(),
        })
        .optional(),
    })
    .optional(),
});

const sessionTitleSchema = z.looseObject({ title: z.string() });

type ResponseBody = z.infer<typeof responseBodySchema>;

/**
 * Walk a claude_code.api_response_body JSON payload and pull out the
 * concatenated assistant text from every `content[]` entry of
 * `type === "text"`. Returns null if the body isn't parseable, has
 * no text blocks, or all text blocks are empty.
 *
 * The body JSON shape per Anthropic's Messages API:
 *   { "content": [
 *       { "type": "text", "text": "..." },
 *       { "type": "tool_use", "name": "...", "input": {...} },
 *       { "type": "thinking", "thinking": "<REDACTED>" },
 *       ...
 *     ], ... }
 *
 * tool_use blocks are intentionally NOT folded into langwatch.output —
 * they're tool invocations, not the assistant's reply. They surface
 * separately via the `tool_decision` + `tool_result` events.
 *
 * thinking blocks come back redacted by Anthropic anyway, so there's
 * nothing useful to lift.
 *
 * @internal exported for unit testing only
 */
export function extractAssistantTextFromResponseBody(raw: unknown): string | null {
  const parsed = parseJsonBody(raw);
  if (parsed === null) {
    return null;
  }

  return extractAssistantText(parsed);
}

function extractAssistantText(parsed: ResponseBody): string | null {
  const parts: string[] = [];
  for (const block of parsed.content ?? []) {
    if (block.type !== "text") {
      continue;
    }
    if (!block.text) {
      continue;
    }
    parts.push(block.text);
  }
  if (parts.length === 0) {
    return null;
  }

  return capPayloadString(parts.join("\n\n"), void 0, "assistant_output");
}

/**
 * How much of a generated title is kept. Titles are a phrase, so anything past
 * this is either a model that ignored the instruction or a body that is not a
 * title at all; the cap bounds what lands in a durable session column either
 * way.
 */
const MAX_SESSION_TITLE_CHARS = 512;

/**
 * The conversation title out of a `generate_session_title` response body.
 *
 * Claude generates the title with a haiku utility call whose reply is a
 * `{"title": "..."}` JSON object inside the assistant text block. Any deviation
 * answers null: an unparseable or truncated body, a reply that is not JSON, a
 * shape without a string `title`, or an empty one. Never throws: the caller is
 * on the ingest path, where one odd body must not cost a record.
 *
 * The CALLER decides which bodies are titles (the `query_source` gate); this
 * only reads the shape.
 */
export function extractSessionTitleFromResponseBody(raw: string): string | null {
  const text = extractAssistantTextFromResponseBody(raw);
  if (text === null) {
    return null;
  }

  const title = tryParseJson(text, sessionTitleSchema);
  if (title === null) {
    return null;
  }

  const trimmed = title.title.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed.slice(0, MAX_SESSION_TITLE_CHARS);
}

/**
 * Anthropic's per-TTL cache-write split out of a response body's usage:
 * `usage.cache_creation.{ephemeral_5m_input_tokens, ephemeral_1h_input_tokens}`.
 * Returns null when the body is unparseable or carries no split (older API
 * responses report only the flat cache_creation_input_tokens total).
 *
 * @internal exported for unit testing
 */
export function extractCacheCreationTtlSplit(raw: unknown): {
  ephemeral5mInputTokens: number;
  ephemeral1hInputTokens: number;
} | null {
  const parsed = parseJsonBody(raw);
  const split = parsed?.usage?.cache_creation;
  if (split === void 0) {
    return null;
  }

  const fiveMinute = asNumber(split.ephemeral_5m_input_tokens) ?? 0;
  const oneHour = asNumber(split.ephemeral_1h_input_tokens) ?? 0;
  if (fiveMinute <= 0 && oneHour <= 0) {
    return null;
  }
  return {
    ephemeral5mInputTokens: fiveMinute,
    ephemeral1hInputTokens: oneHour,
  };
}

/**
 * Parse a string-or-already-parsed JSON body into an object. The upstream
 * attribute bag (`parseJsonStringValues`) eagerly JSON.parses string
 * attributes that look like JSON, so a body attribute can arrive as either a
 * raw string OR a pre-parsed object — accept both. Returns null when absent or
 * unparseable (claude truncates large bodies inline, making them invalid JSON).
 */
function parseJsonBody(raw: unknown): ResponseBody | null {
  if (raw === null || raw === void 0) {
    return null;
  }

  let parsed = raw;
  if (typeof raw === "string") {
    if (raw.length === 0) {
      return null;
    }
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const result = responseBodySchema.safeParse(parsed);
  return result.success ? result.data : null;
}

/**
 * The assistant's reply for a model call, rendered from its api_response_body.
 * Unlike {@link extractAssistantTextFromResponseBody} (the headline path, text
 * only), this includes `tool_use` blocks so a model call whose reply IS a tool
 * invocation still shows what it did: the call that decided to run Bash renders
 * `[tool_use: Bash]` plus the command instead of an empty output. Text and
 * tool_use blocks are concatenated in wire order.
 *
 * The trace headline keeps the text-only extractor so a tool-deciding turn's
 * headline stays the final text reply, not a tool marker.
 *
 * @internal exported for unit testing
 */
export function extractAssistantOutputFromResponseBody(raw: unknown): string | null {
  const parsed = parseJsonBody(raw);
  if (parsed === null) {
    return null;
  }

  return extractAssistantOutput(parsed);
}

function extractAssistantOutput(parsed: ResponseBody): string | null {
  const parts: string[] = [];
  for (const block of parsed.content ?? []) {
    if (block.type === "text") {
      if (block.text) {
        parts.push(block.text);
      }
    } else if (block.type === "tool_use" && block.name) {
      const args = block.input !== void 0 && block.input !== null ? safeStringify(block.input) : "";
      parts.push(args ? `[tool_use: ${block.name}]\n${args}` : `[tool_use: ${block.name}]`);
    }
  }
  if (parts.length === 0) {
    return null;
  }
  return capPayloadString(parts.join("\n\n"), void 0, "assistant_output");
}

export function deriveClaudeResponseBody(raw: unknown): {
  assistantText: string | null;
  assistantOutput: string | null;
  sessionTitle: string | null;
} {
  const parsed = parseJsonBody(raw);
  if (parsed === null) {
    return { assistantText: null, assistantOutput: null, sessionTitle: null };
  }

  const assistantText = extractAssistantText(parsed);
  const sessionTitle =
    typeof raw === "string" && assistantText !== null ? extractSessionTitle(assistantText) : null;

  return {
    assistantText,
    assistantOutput: extractAssistantOutput(parsed),
    sessionTitle,
  };
}

function extractSessionTitle(text: string): string | null {
  const parsed = tryParseJson(text, sessionTitleSchema);
  if (parsed === null) {
    return null;
  }

  const title = parsed.title.trim();
  return title.length > 0 ? title.slice(0, MAX_SESSION_TITLE_CHARS) : null;
}

function tryParseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** JSON.stringify that never throws on a circular/odd value. */
function safeStringify(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return "";
  }
}
