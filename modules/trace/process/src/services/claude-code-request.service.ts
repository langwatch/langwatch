import { z } from "zod";

import { contentToText, buildToolDefinitionsMessage } from "../rules/claude-code-content.rules.ts";
import { capPayloadString } from "../rules/trace-payload-cap.rules.ts";
import { ClaudeCodeTruncatedRequestService } from "./claude-code-truncated-request.service.ts";

const claudeCodeTruncatedRequestService = ClaudeCodeTruncatedRequestService.create();

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
 * What a Claude Code request body says, for the canonical span. Counterpart
 * to {@link ClaudeCodeResponseService}, total for the same reason: a
 * truncated body arrives often enough that salvaging one is its own module.
 */
export class ClaudeCodeRequestService {
  private constructor() {}

  static create(): ClaudeCodeRequestService {
    return new ClaudeCodeRequestService();
  }

  private extractToolResults(parsed: RequestBody): Map<string, string> {
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

  private buildInputMessages(parsed: RequestBody): { role: string; content: string }[] | null {
    const out: { role: string; content: string }[] = [];

    if (parsed.system !== void 0) {
      const systemText = contentToText(parsed.system);
      if (systemText.length > 0) {
        out.push({ role: "system", content: systemText });
      }
    }

    const toolsMessage = buildToolDefinitionsMessage(parsed.tools);
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

  private tryParseRequestBody(raw: unknown): RequestBody | null {
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
   * Harvests tool result content from request body. Telemetry lacks tool stdout,
   * which appears in the next request's tool_result blocks, keyed by tool_use_id.
   * @internal exported for read-time tool-span enrichment + unit testing
   */
  extractToolResultsFromRequestBody(raw: unknown): Map<string, string> {
    const parsed = this.tryParseRequestBody(raw);

    return parsed === null ? new Map() : this.extractToolResults(parsed);
  }

  /**
   * Parses request body into canonical chat array with system prompt and turns.
   * Returns null when unparseable, no messages array, or every turn empty.
   * @internal exported for ingest-time body derivation + unit testing
   */
  buildInputMessagesFromRequestBody(raw: unknown): { role: string; content: string }[] | null {
    const parsed = this.tryParseRequestBody(raw);
    if (parsed !== null) {
      return this.buildInputMessages(parsed);
    }

    return typeof raw === "string"
      ? claudeCodeTruncatedRequestService.parseTruncatedMessages(raw)
      : null;
  }

  deriveClaudeRequestBody(raw: unknown): {
    messages: { role: string; content: string }[] | null;
    toolResults: Map<string, string>;
  } {
    const parsed = this.tryParseRequestBody(raw);
    if (parsed !== null) {
      return {
        messages: this.buildInputMessages(parsed),
        toolResults: this.extractToolResults(parsed),
      };
    }

    return {
      messages:
        typeof raw === "string"
          ? claudeCodeTruncatedRequestService.parseTruncatedMessages(raw)
          : null,
      toolResults: new Map(),
    };
  }
}
