/**
 * Spring AI Extractor
 *
 * Handles: Spring AI ChatModel observation log records. Spring's
 * observability scopes emit two log record types, each carrying the
 * conversation half as a body string with a leading identifier:
 *
 * - ChatModelPromptContentObservationHandler emits a record whose
 *   body starts with "Chat Model Prompt Content:\n" followed by the
 *   prompt text.
 * - ChatModelCompletionObservationHandler emits a record whose body
 *   starts with "Chat Model Completion:\n" followed by the assistant
 *   response.
 *
 * Detection: log record scope is one of SPRING_AI_SCOPE_NAMES.
 *
 * Canonical attributes produced:
 * - langwatch.input  (from the prompt body)
 * - langwatch.output (from the completion body)
 *
 * Span-side `apply()` is a no-op — Spring AI also emits gen_ai.*
 * spans through Micrometer when configured, which GenAIExtractor
 * handles. This extractor is the log-only counterpart.
 */

import type {
  CanonicalAttributesExtractor,
  ExtractorContext,
  LogExtractorContext,
} from "./_types";

const SPRING_AI_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
]);

const PROMPT_IDENTIFIER = "Chat Model Prompt Content:";
const COMPLETION_IDENTIFIER = "Chat Model Completion:";

export class SpringAIExtractor implements CanonicalAttributesExtractor {
  readonly id = "spring-ai";

  apply(_ctx: ExtractorContext): void {
    // Spring AI emits gen_ai.* spans via Micrometer when configured;
    // GenAIExtractor handles that side. Nothing to do here.
  }

  applyLog(ctx: LogExtractorContext): void {
    if (!SPRING_AI_SCOPE_NAMES.has(ctx.bag.scopeName)) return;

    const body = ctx.bag.body;
    if (typeof body !== "string" || body.length === 0) return;

    const newlineIdx = body.indexOf("\n");
    if (newlineIdx < 0) return;
    const identifier = body.slice(0, newlineIdx);
    const content = body.slice(newlineIdx + 1);
    if (content.length === 0) return;

    if (identifier === PROMPT_IDENTIFIER) {
      ctx.setAttr("langwatch.input", content);
      ctx.recordRule("spring-ai/prompt");
      return;
    }
    if (identifier === COMPLETION_IDENTIFIER) {
      ctx.setAttr("langwatch.output", content);
      ctx.recordRule("spring-ai/completion");
      return;
    }
  }
}
