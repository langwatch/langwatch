/**
 * The write-time attribute trim both slim analytics folds share
 * (migrations 00039 and 00041 both document it). The summary folds accumulate
 * every canonicalised attribute, roughly half of which is payload; an analytics
 * row must carry only what a dimension query could group or filter on.
 */

/** Cap for a key that IS a dimension by definition — `metadata.*` and `langwatch.reserved.*`. */
export const ANALYTICS_METADATA_VALUE_CAP = 4096;

/** Appended to a truncated value so the truncation is visible in the row. */
export const ANALYTICS_TRUNCATION_ELLIPSIS = "…";

/** Cap for any other key. Past this a value is overwhelmingly a payload artefact. */
export const ANALYTICS_STANDARD_VALUE_CAP = 256;

/** Keys that carry message, completion or choices payloads whatever their length. */
export const PAYLOAD_BLOCKLIST_EXACT: ReadonlySet<string> = new Set([
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.response.choices",
  "gen_ai.response.finish_reasons",
  "raw_input",
  "input.value",
  "output.value",
  "input",
  "output",
  "mastra.output",
  "mastra.agent_run.input",
  "mastra.agent_run.output",
  "mastra.model_step.output",
  "mastra.model_step.input",
  "traceloop.entity.input",
  "traceloop.entity.output",
  "langwatch.input",
  "langwatch.output",
  "langwatch.claude_code.request_body",
  "langwatch.claude_code.response_body",
  "retrieval.documents",
  "llm.input_messages",
  "llm.output_messages",
]);

/** Namespaced payload keys. Each MUST end with `.`, so `gen_ai.prompt_id` survives. */
export const PAYLOAD_BLOCKLIST_PREFIXES: readonly string[] = [
  "gen_ai.prompt.",
  "gen_ai.completion.",
  "gen_ai.response.choices.",
  "gen_ai.response.finish_reasons.",
  "llm.input_messages.",
  "llm.output_messages.",
];

const METADATA_PREFIX = "metadata.";
const RESERVED_PREFIX = "langwatch.reserved.";

/**
 * Keys a fold accumulates by read-modify-write on its own previous value.
 * Dropping one does not shrink the row, it resets the accumulator: the trimmed
 * map is what the fold reads back as state.
 */
const FOLD_ACCUMULATOR_KEYS: ReadonlySet<string> = new Set([
  "langwatch.prompt_ids",
]);

function isBlocklisted(key: string): boolean {
  if (PAYLOAD_BLOCKLIST_EXACT.has(key)) return true;
  return PAYLOAD_BLOCKLIST_PREFIXES.some((prefix) => key.startsWith(prefix));
}

function truncateWithEllipsis(value: string, cap: number): string {
  return value.length <= cap
    ? value
    : value.slice(0, cap) + ANALYTICS_TRUNCATION_ELLIPSIS;
}

/** Pure: returns a new map, never mutates the input. */
export function trimAttributesForAnalytics(
  attrs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") continue;
    if (isBlocklisted(key)) continue;

    if (
      key.startsWith(METADATA_PREFIX) ||
      key.startsWith(RESERVED_PREFIX) ||
      FOLD_ACCUMULATOR_KEYS.has(key)
    ) {
      out[key] = truncateWithEllipsis(value, ANALYTICS_METADATA_VALUE_CAP);
      continue;
    }
    if (value.length <= ANALYTICS_STANDARD_VALUE_CAP) out[key] = value;
  }
  return out;
}
