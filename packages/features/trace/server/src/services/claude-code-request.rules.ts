import { z } from "zod";
import { contentToText, toolDefinitionsMessage } from "./claude-code-content.rules";
import { ClaudeCodeTruncatedRequest } from "./claude-code-truncated-request.rules";
import { capPayloadString } from "./trace-payload-cap.rules";

const requestMessageSchema = z.looseObject({
  role: z.string().optional(),
  content: z.unknown().optional(),
});

const requestBodySchema = z.looseObject({
  system: z.unknown().optional(),
  messages: z.array(requestMessageSchema),
  tools: z.unknown().optional(),
});

const toolResultSchema = z.looseObject({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
  content: z.unknown().optional(),
});

type RequestBody = z.infer<typeof requestBodySchema>;

/**
 * What a Claude Code request body says, for the canonical span.
 *
 * The counterpart to {@link ClaudeCodeResponse}, and total for the same
 * reason. A request body arrives truncated often enough that salvaging one is
 * its own module.
 */
export class ClaudeCodeRequest {
  private static extractToolResults(parsed: RequestBody): Map<string, string> {
    const out = new Map<string, string>();
    for (const message of parsed.messages) {
      const content = message.content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const block of content) {
        const result = toolResultSchema.safeParse(block);
        if (!result.success || out.has(result.data.tool_use_id)) {
          continue;
        }

        const text = contentToText(result.data.content);
        if (text.length > 0) {
          out.set(result.data.tool_use_id, capPayloadString(text, void 0, "tool_result"));
        }
      }
    }
    return out;
  }

  private static buildInputMessages(
    parsed: RequestBody,
  ): Array<{ role: string; content: string }> | null {
    const out: Array<{ role: string; content: string }> = [];

    if (parsed.system !== void 0) {
      const systemText = contentToText(parsed.system);
      if (systemText.length > 0) {
        out.push({ role: "system", content: systemText });
      }
    }

    const toolsMessage = toolDefinitionsMessage(parsed.tools);
    if (toolsMessage !== null) {
      out.push(toolsMessage);
    }

    for (const message of parsed.messages) {
      const role = typeof message.role === "string" ? message.role : "user";
      const content = contentToText(message.content);
      if (content.length === 0) {
        continue;
      }
      out.push({ role, content });
    }

    return out.length > 0 ? out : null;
  }

  private static tryParseRequestBody(raw: unknown): RequestBody | null {
    if (raw === null || raw === void 0 || raw === "") {
      return null;
    }

    let parsed = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
    }

    const result = requestBodySchema.safeParse(parsed);
    return result.success ? result.data : null;
  }

  /**
   * Harvest tool RESULT content out of an `api_request_body` payload.
   *
   * Claude's telemetry never ships tool stdout on the `tool_result` event (it
   * carries sizes only) — the actual result text appears one turn LATER, as the
   * `tool_result` content blocks of the NEXT model call's request body, keyed by
   * `tool_use_id`. With `OTEL_LOG_RAW_API_BODIES=1` those bodies are in the
   * trace's logs, so a read-time join can put the real output back on the tool
   * span. Returns `tool_use_id` → flattened content text for every tool_result
   * block found; empty map when the body is unparseable or has none.
   *
   * @internal exported for the read-time tool-span enrichment + unit testing
   */
  static extractToolResultsFromRequestBody(raw: unknown): Map<string, string> {
    const parsed = ClaudeCodeRequest.tryParseRequestBody(raw);
    return parsed === null ? new Map() : ClaudeCodeRequest.extractToolResults(parsed);
  }

  /**
   * Parse a claude_code.api_request_body JSON payload (the Anthropic
   * /v1/messages REQUEST) into the canonical `gen_ai.input.messages` chat array:
   * the system prompt (when present) followed by every turn as `{ role, content }`
   * with each message's content flattened to text via {@link contentToText}.
   *
   * This is what makes the trace detail render a real multi-turn conversation
   * instead of a single user message holding the raw request JSON. Returns null
   * when the body isn't parseable (claude truncates large bodies inline, so the
   * caller falls back to the clean `user_prompt` text), has no `messages` array,
   * or every turn flattened to empty.
   *
   * @internal exported for the ingest-time body derivation + unit testing
   */
  static buildInputMessagesFromRequestBody(
    raw: unknown,
  ): Array<{ role: string; content: string }> | null {
    const parsed = ClaudeCodeRequest.tryParseRequestBody(raw);
    if (parsed !== null) {
      return ClaudeCodeRequest.buildInputMessages(parsed);
    }
    return typeof raw === "string" ? ClaudeCodeTruncatedRequest.salvage(raw) : null;
  }

  static deriveClaudeRequestBody(raw: unknown): {
    messages: Array<{ role: string; content: string }> | null;
    toolResults: Map<string, string>;
  } {
    const parsed = ClaudeCodeRequest.tryParseRequestBody(raw);
    if (parsed !== null) {
      return {
        messages: ClaudeCodeRequest.buildInputMessages(parsed),
        toolResults: ClaudeCodeRequest.extractToolResults(parsed),
      };
    }

    return {
      messages: typeof raw === "string" ? ClaudeCodeTruncatedRequest.salvage(raw) : null,
      toolResults: new Map(),
    };
  }
}
