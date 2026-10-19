// Trim trace_analytics at write time; payload and oversized keys are dropped so
// fold state stays bounded

/** Hard cap on a `metadata.*` value's length (chars, not bytes). */
export const ANALYTICS_METADATA_VALUE_CAP = 4096;

/** Ellipsis appended to a truncated value so truncation is visible at read. */
export const ANALYTICS_TRUNCATION_ELLIPSIS = "…"; // "…"

/** Hard cap on an arbitrary (non-metadata, non-reserved) attribute value's length. */
export const ANALYTICS_STANDARD_VALUE_CAP = 256;

// Exact-match keys that carry payload blobs, never analytics dimensions
export const PAYLOAD_BLOCKLIST_EXACT: Readonly<Record<string, true>> = {
  "gen_ai.prompt": true,
  "gen_ai.completion": true,
  "gen_ai.response.choices": true,
  "gen_ai.response.finish_reasons": true,
  // Logfire's raw input/output blobs — payload, not dimension.
  raw_input: true,
  // OpenInference / Mastra / Traceloop input/output value carriers.
  "input.value": true,
  "output.value": true,
  input: true,
  output: true,
  "mastra.output": true,
  "mastra.agent_run.input": true,
  "mastra.agent_run.output": true,
  "mastra.model_step.output": true,
  "mastra.model_step.input": true,
  "traceloop.entity.input": true,
  "traceloop.entity.output": true,
  // LangWatch's own input/output carriers and the Claude Code request /
  // response bodies (the whole conversation history with tool schemas).
  "langwatch.input": true,
  "langwatch.output": true,
  "langwatch.claude_code.request_body": true,
  "langwatch.claude_code.response_body": true,
  // Haystack documents and OpenInference messages — verbose payloads.
  "retrieval.documents": true,
  "llm.input_messages": true,
  "llm.output_messages": true,
};

// Prefix-form blocklist for namespaced payload keys; prefixes MUST end with '.'
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

// Keys that fold accumulates across spans by read-modify-write; must survive
// trim since dropping one resets the accumulator. @see ADR-066
const FOLD_ACCUMULATOR_KEYS: Readonly<Record<string, true>> = {
  "langwatch.prompt_ids": true,
};

function isBlocklisted(key: string): boolean {
  if (PAYLOAD_BLOCKLIST_EXACT[key] === true) return true;
  for (const prefix of PAYLOAD_BLOCKLIST_PREFIXES) {
    if (key.startsWith(prefix)) return true;
  }
  return false;
}

function truncateWithEllipsis(value: string, cap: number): string {
  if (value.length <= cap) return value;
  return value.slice(0, cap) + ANALYTICS_TRUNCATION_ELLIPSIS;
}

/**
 * Trim a trace-level Attributes map for the slim analytics fold.
 *
 * Pure: returns a new object; never mutates the input.
 */
export function trimAttributesForAnalytics(attrs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") continue;
    if (isBlocklisted(key)) continue;

    if (key.startsWith(METADATA_PREFIX)) {
      out[key] = truncateWithEllipsis(value, ANALYTICS_METADATA_VALUE_CAP);
      continue;
    }
    if (key.startsWith(RESERVED_PREFIX) || FOLD_ACCUMULATOR_KEYS[key] === true) {
      out[key] = truncateWithEllipsis(value, ANALYTICS_METADATA_VALUE_CAP);
      continue;
    }
    if (value.length <= ANALYTICS_STANDARD_VALUE_CAP) {
      out[key] = value;
    }
    // else: drop the over-cap arbitrary key — payload or unbounded blob.
  }
  return out;
}
