/**
 * Extract a trace's input and output from a LOG RECORD rather than a span.
 *
 * Spring AI and Claude Code report the conversation as logs, not span
 * attributes, so the summary projection reads them through here and hands the
 * result to `TraceIOAccumulationService` alongside what the spans said. It
 * lived in that service's file, which made a 500-line module out of two
 * unrelated subjects: one folds spans, this one reads logs.
 */

import type {
  LogRecordReceivedEventData,
  TraceCanonicalisationService,
} from "@langwatch/trace-contract";
import { CLAUDE_CODE_SCOPE_NAMES } from "./canonicalisation/claude-code.canonicaliser";
import { SPRING_AI_SCOPE_NAMES } from "./canonicalisation/spring-ai.canonicaliser";

/**
 * Reads a trace's headline input and output out of one log record.
 *
 * The canonicalisation service is the only collaborator and it never varies per
 * record, so it is held rather than threaded through every call.
 */
type TraceLogIO = { input: string | null; output: string | null };

const NO_IO: TraceLogIO = { input: null, output: null };

export class TraceLogRecordIOService {
  private constructor(private readonly canonicalisation: TraceCanonicalisationService) {}

  static create(canonicalisation: TraceCanonicalisationService): TraceLogRecordIOService {
    return new TraceLogRecordIOService(canonicalisation);
  }

  /**
   * Spring AI, Claude Code and Codex each report the conversation as logs
   * rather than span attributes, and each in its own shape.
   *
   * A vendor returning `null` means "not mine, or nothing here" and the next
   * one gets a look — Spring AI is the one exception, and says so.
   */
  extractIO(data: LogRecordReceivedEventData): TraceLogIO {
    return this.fromSpringAI(data) ?? this.fromClaudeCode(data) ?? this.fromCodex(data) ?? NO_IO;
  }

  /**
   * Spring AI puts an identifier on the first line and the content underneath.
   *
   * A record in this scope with no content is answered rather than passed on:
   * it is a Spring AI record, it simply has nothing in it.
   */
  private fromSpringAI(data: LogRecordReceivedEventData): TraceLogIO | null {
    if (!SPRING_AI_SCOPE_NAMES.has(data.scopeName)) {
      return null;
    }

    const [identifier, ...contentParts] = data.body.split("\n");
    const content = contentParts.join("\n");
    if (!identifier || !content) {
      return NO_IO;
    }
    if (identifier === "Chat Model Prompt Content:") {
      return { input: content, output: null };
    }
    if (identifier === "Chat Model Completion:") {
      return { input: null, output: content };
    }

    return null;
  }

  private fromClaudeCode(data: LogRecordReceivedEventData): TraceLogIO | null {
    if (!CLAUDE_CODE_SCOPE_NAMES.has(data.scopeName)) {
      return null;
    }

    // Gated on `user_prompt` specifically. Any claude_code record with a
    // `prompt` attribute would otherwise win, including internal subagent calls
    // — a Bash tool subagent emitting `prompt:"env"` would put the shell
    // command in the trace input instead of what the user typed.
    if (data.attributes["event.name"] === "user_prompt") {
      const prompt = data.attributes.prompt;
      if (typeof prompt === "string" && prompt) {
        return { input: prompt, output: null };
      }
    }

    // With OTEL_LOG_RAW_API_BODIES=1 the reply arrives as a full
    // /v1/messages body; without it, on an `assistant_response` event. The two
    // are per-session alternatives carrying the same text, so accepting both
    // cannot double-lift.
    if (this.isConversationalTurn(data, "api_response_body")) {
      const responseText = this.canonicalisation.deriveClaudeResponseContent({
        body: data.attributes.body,
      }).assistantText;
      if (responseText !== null) {
        return { input: null, output: responseText };
      }
    }

    if (this.isConversationalTurn(data, "assistant_response")) {
      const response = data.attributes.response;
      if (typeof response === "string" && response.length > 0) {
        return { input: null, output: response };
      }
    }

    return null;
  }

  /**
   * Claude emits reply-shaped events for its utility calls too — autosuggest,
   * session titles — and their text is not the assistant's reply. Output is
   * last-write-wins, so an unfiltered title clobbers the real one. Mirrors the
   * gate on the canonical span path so both output paths agree.
   */
  private isConversationalTurn(data: LogRecordReceivedEventData, eventName: string): boolean {
    return (
      data.attributes["event.name"] === eventName &&
      this.canonicalisation.classifyClaudeCall({
        querySource:
          typeof data.attributes.query_source === "string" ? data.attributes.query_source : null,
      }).conversational
    );
  }

  /**
   * Codex puts the user's text on its own event. The cost-bearing sse_event
   * records carry no prompt, so the input is lifted here and paired with the
   * model and token lift from the same trace.
   */
  private fromCodex(data: LogRecordReceivedEventData): TraceLogIO | null {
    if (data.attributes["event.name"] !== "codex.user_prompt") {
      return null;
    }

    const prompt = data.attributes.prompt;

    return typeof prompt === "string" && prompt.length > 0 ? { input: prompt, output: null } : null;
  }
}
