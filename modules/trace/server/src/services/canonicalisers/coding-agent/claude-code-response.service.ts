import { z } from "zod";
import { asNumber } from "../../../rules/canonical-guard.rules.ts";
import { capPayloadString } from "../../../rules/trace-payload-cap.rules.ts";

const responseContentBlockSchema = z.looseObject({
  type: z.string().optional(),
  text: z.string().optional(),
  name: z.string().optional(),
  input: z.unknown().optional(),
});

type ResponseContentBlock = z.infer<typeof responseContentBlockSchema>;

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
 * How much of a generated title is kept. Titles are a phrase, so anything past
 * this is either a model that ignored the instruction or a body that is not a
 * title at all; the cap bounds what lands in a durable session column either
 * way.
 */
const MAX_SESSION_TITLE_CHARS = 512;

/**
 * What a Claude Code response body says, for the canonical span.
 *
 * The bodies arrive as JSON text that may be malformed or truncated, so every
 * reader here is total: it answers what it can find and nothing when it finds
 * nothing. A throw would lose the span, and a span is still worth storing when
 * only its text could not be read.
 */
export class ClaudeCodeResponseService {
  private constructor() {}

  static create(): ClaudeCodeResponseService {
    return new ClaudeCodeResponseService();
  }

  private extractAssistantText(parsed: ResponseBody): string | null {
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
   * Parse a string-or-already-parsed JSON body into an object. The upstream
   * attribute bag (`parseJsonStringValues`) eagerly JSON.parses string
   * attributes that look like JSON, so a body attribute can arrive as either a
   * raw string OR a pre-parsed object — accept both. Returns null when absent or
   * unparseable (claude truncates large bodies inline, making them invalid JSON).
   */
  private parseJsonBody(raw: unknown): ResponseBody | null {
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

  /** One assistant content block as text, or null when it carries nothing to show. */
  private renderContentBlock(block: ResponseContentBlock): string | null {
    if (block.type === "text") {
      return block.text ? block.text : null;
    }

    const isToolUse = block.type === "tool_use" && Boolean(block.name);
    if (!isToolUse) {
      return null;
    }

    const hasInput = block.input !== void 0 && block.input !== null;
    const args = hasInput ? this.safeStringify(block.input) : "";

    return args ? `[tool_use: ${block.name}]\n${args}` : `[tool_use: ${block.name}]`;
  }

  private extractAssistantOutput(parsed: ResponseBody): string | null {
    const parts: string[] = [];
    for (const block of parsed.content ?? []) {
      const rendered = this.renderContentBlock(block);
      if (rendered !== null) {
        parts.push(rendered);
      }
    }

    if (parts.length === 0) {
      return null;
    }

    return capPayloadString(parts.join("\n\n"), void 0, "assistant_output");
  }

  private extractSessionTitle(text: string): string | null {
    const parsed = this.tryParseJson(text, sessionTitleSchema);
    if (parsed === null) {
      return null;
    }

    const title = parsed.title.trim();

    return title.length > 0 ? title.slice(0, MAX_SESSION_TITLE_CHARS) : null;
  }

  private tryParseJson<T>(raw: string, schema: z.ZodType<T>): T | null {
    try {
      const result = schema.safeParse(JSON.parse(raw));

      return result.success ? result.data : null;
    } catch {
      return null;
    }
  }

  /** JSON.stringify that never throws on a circular/odd value. */
  private safeStringify(value: unknown): string {
    try {
      return typeof value === "string" ? value : JSON.stringify(value);
    } catch {
      return "";
    }
  }

  /**
   * Extracts concatenated assistant text from response body text blocks only.
   * Excludes tool_use (tool invocations, not replies) and thinking (redacted by Anthropic).
   * @internal exported for unit testing only
   */
  tryExtractAssistantTextFromResponseBody(raw: unknown): string | null {
    const parsed = this.parseJsonBody(raw);
    if (parsed === null) {
      return null;
    }

    return this.extractAssistantText(parsed);
  }

  /**
   * Extracts title from title-generation response body JSON.
   * Never throws to avoid blocking ingest on malformed bodies.
   */
  tryExtractSessionTitleFromResponseBody(raw: string): string | null {
    const text = this.tryExtractAssistantTextFromResponseBody(raw);
    if (text === null) {
      return null;
    }

    const title = this.tryParseJson(text, sessionTitleSchema);
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
  tryExtractCacheCreationTtlSplit(raw: unknown): {
    ephemeral5mInputTokens: number;
    ephemeral1hInputTokens: number;
  } | null {
    const parsed = this.parseJsonBody(raw);
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
   * Extracts assistant reply including tool_use blocks (unlike text-only extractor).
   * Trace headline uses text-only to keep final text reply instead of tool marker.
   * @internal exported for unit testing
   */
  tryExtractAssistantOutputFromResponseBody(raw: unknown): string | null {
    const parsed = this.parseJsonBody(raw);
    if (parsed === null) {
      return null;
    }

    return this.extractAssistantOutput(parsed);
  }

  deriveClaudeResponseBody(raw: unknown): {
    assistantText: string | null;
    assistantOutput: string | null;
    sessionTitle: string | null;
  } {
    const parsed = this.parseJsonBody(raw);
    if (parsed === null) {
      return { assistantText: null, assistantOutput: null, sessionTitle: null };
    }

    const assistantText = this.extractAssistantText(parsed);
    const sessionTitle =
      typeof raw === "string" && assistantText !== null
        ? this.extractSessionTitle(assistantText)
        : null;

    return {
      assistantText,
      assistantOutput: this.extractAssistantOutput(parsed),
      sessionTitle,
    };
  }
}
