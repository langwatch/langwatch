import type { ContentCategory } from "./data-privacy";

/**
 * The built-in span-attribute keys that carry each content category. When a
 * category is set to `drop`, every key in its set is stripped before the span
 * is stored. Seeded from the OpenTelemetry GenAI conventions plus the vendor
 * dialects LangWatch ingests (Vercel AI SDK, OpenInference, Traceloop) and the
 * LangWatch-canonicalised `langwatch.input`/`langwatch.output`. Metadata keys
 * (tokens, cost, model, latency, ids, names, status) are deliberately absent,
 * so they always survive a drop.
 *
 * This is a CONTRACT rather than an implementation detail of the drop: the
 * same lists gate which LWQL views may read content, and the trace read path
 * uses them to explain an absence. A key missing from a list here is a key
 * that SURVIVES a drop — the customer asked for that content to be removed and
 * it was stored anyway — so the lists are pinned member-for-member, in order,
 * by `__tests__/data-privacy.content-catalog.unit.test.ts`.
 *
 * The application's copy is
 * `platform/app/src/server/data-privacy/dropKeyCatalog.ts`, which stays as it
 * is while both graphs ingest.
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
