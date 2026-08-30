/** Maps Spring AI prompt/completion observation log bodies to canonical I/O. */

import type {
  CanonicalAttributesPort,
  ExtractorContext,
  LogExtractorContext,
} from "../../ports/canonical-attributes.port";

export const SPRING_AI_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
]);

const PROMPT_IDENTIFIER = "Chat Model Prompt Content:";
const COMPLETION_IDENTIFIER = "Chat Model Completion:";

export class SpringAICanonicaliser implements CanonicalAttributesPort {
  readonly id = "spring-ai";

  apply(_ctx: ExtractorContext): void {
    // Spring AI emits gen_ai.* spans via Micrometer when configured;
    // GenAICanonicaliser handles that side. Nothing to do here.
  }

  applyLog(ctx: LogExtractorContext): void {
    if (!SPRING_AI_SCOPE_NAMES.has(ctx.bag.scopeName)) {
      return;
    }

    const body = ctx.bag.body;
    if (typeof body !== "string" || body.length === 0) {
      return;
    }

    const newlineIdx = body.indexOf("\n");
    if (newlineIdx < 0) {
      return;
    }
    const identifier = body.slice(0, newlineIdx);
    const content = body.slice(newlineIdx + 1);
    if (content.length === 0) {
      return;
    }

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
