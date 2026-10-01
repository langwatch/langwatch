import type { ContentCategory } from "./data-privacy.ts";

/**
 * Built-in span-attribute keys for each content category. When `drop` is set,
 * these keys are stripped before storage. Contract: gates LWQL content visibility
 * and pinned against platform/app's dropKeyCatalog.
 */
export const CONTENT_KEY_CATALOG: Record<ContentCategory, readonly string[]> = {
  input: [
    "gen_ai.input.messages",
    "gen_ai.prompt",
    "ai.prompt",
    "ai.prompt.messages",
    "llm.input_messages",
    "langwatch.input",
    "input",
    "input.value",
    "raw_input",
    "traceloop.entity.input",
  ],
  output: [
    "gen_ai.output.messages",
    "gen_ai.completion",
    "gen_ai.response.choices",
    "gen_ai.response.finish_reasons",
    "ai.response",
    "ai.response.text",
    "ai.response.object",
    "llm.output_messages",
    "langwatch.output",
    "output",
    "output.value",
    "traceloop.entity.output",
  ],
  system: ["gen_ai.system_instructions"],
  tools: [
    "gen_ai.tool.call.arguments",
    "gen_ai.tool.call.result",
    "ai.toolCall",
    "ai.toolCall.args",
  ],
};

/** Catalog keys whose value is a chat-message conversation (input and output). */
export const CHAT_ARRAY_KEYS: ReadonlySet<string> = new Set([
  ...CONTENT_KEY_CATALOG.input,
  ...CONTENT_KEY_CATALOG.output,
]);
