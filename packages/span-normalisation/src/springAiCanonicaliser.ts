/** Maps Spring AI prompt/completion observation log bodies to canonical I/O. */

import type {
  AttributeCanonicaliser,
  ExtractorContext,
  LogExtractorContext,
} from "./canonicalAttributes.ts";
import { isAnthropicProviderSpan, markInputAsFresh } from "./canonicalExtraction.ts";

export const SPRING_AI_SCOPE_NAMES: ReadonlySet<string> = new Set([
  "org.springframework.ai.chat.observation.ChatModelCompletionObservationHandler",
  "org.springframework.ai.chat.observation.ChatModelPromptContentObservationHandler",
]);

const SPRING_AI_KIND = "spring.ai.kind";

const PROMPT_IDENTIFIER = "Chat Model Prompt Content:";
const COMPLETION_IDENTIFIER = "Chat Model Completion:";

export class SpringAICanonicaliserService implements AttributeCanonicaliser {
  static create(): SpringAICanonicaliserService {
    return new SpringAICanonicaliserService();
  }

  private constructor() {}

  readonly id = "spring-ai";

  /**
   * Spring AI's gen_ai.* spans are read by GenAICanonicaliserService. Its Anthropic model reports
   * the API's input count, which excludes the cache, unlike the GenAI conventions.
   */
  apply(ctx: ExtractorContext): void {
    if (ctx.bag.attrs.has(SPRING_AI_KIND) && isAnthropicProviderSpan(ctx)) {
      markInputAsFresh(ctx, { ruleId: `${this.id}:usage.input_tokens(fresh as sent)` });
    }
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
