/**
 * Trims the `trace_analytics` attribute map at write time. Metadata and
 * reserved values are capped but retained; known payload keys and oversized
 * arbitrary values are removed. The map is read back as fold state, so this is
 * deliberately a bounded best-effort dimension representation.
 */

/** Hard cap on a `metadata.*` value's length (chars, not bytes). */
export const ANALYTICS_METADATA_VALUE_CAP = 4096;

/** Ellipsis appended to a truncated value so truncation is visible at read. */
export const ANALYTICS_TRUNCATION_ELLIPSIS = "…"; // "…"

/** Hard cap on an arbitrary (non-metadata, non-reserved) attribute value's length. */
export const ANALYTICS_STANDARD_VALUE_CAP = 256;

/**
 * Keys known to carry message / completion / choices payloads. They're
 * accumulated onto trace_summaries.Attributes when canonicalisation extractors
 * run, but they're NOT analytics dimensions — a query filtering on the FULL
 * prompt text is pathological. Drop them from slim regardless of length.
 *
 * Discovered by inspecting the canonicalisation extractors + the SDK span
 * attribute contract (project_sdk_span_attribute_contract memory). Keys
 * mentioned in trace-attribute-accumulation are the ones we hoist; this list
 * is the COMPLEMENT — things never lifted onto the trace map by the
 * accumulation service, but possibly present from older extractors that
 * lifted verbatim, OR from a downstream blob-style attribute the SDK passes.
 *
 * Each entry is matched as either an EXACT key match or a PREFIX match (when
 * the key ends with `.`). A user is invited to add to either set when a new
 * payload-shaped attribute appears in trace_summaries Attributes.
 */
export const PAYLOAD_BLOCKLIST_EXACT: ReadonlySet<string> = new Set([
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.response.choices",
  "gen_ai.response.finish_reasons",
  // Logfire's raw input/output blobs — payload, not dimension.
  "raw_input",
  // OpenInference / Mastra / Traceloop input/output value carriers.
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
  // LangWatch's own input/output carriers and the Claude Code request /
  // response bodies (the whole conversation history with tool schemas).
  "langwatch.input",
  "langwatch.output",
  "langwatch.claude_code.request_body",
  "langwatch.claude_code.response_body",
  // Haystack documents and OpenInference messages — verbose payloads.
  "retrieval.documents",
  "llm.input_messages",
  "llm.output_messages",
]);

/**
 * Prefix-form blocklist for namespaced payload keys (e.g.
 * `gen_ai.prompt.0.content` from SDKs that emit indexed message arrays).
 * Listed prefixes MUST end with `.` to avoid catching `gen_ai.prompt_id`
 * or similar identifier-shaped keys.
 */
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
 * Keys the fold accumulates across spans by read-modify-write on its OWN
 * previous value, rather than deriving fresh from each event.
 *
 * These must survive the trim. Under ADR-066 the trimmed map is read back as
 * fold state, so dropping one does not merely shrink the stored row — it resets
 * the accumulator, and the union silently restarts from the next span. Every
 * other accumulator already sits under `langwatch.reserved.` and is kept for
 * that reason; `langwatch.prompt_ids` is the one that does not, and at ~8
 * prompt-bearing spans its JSON crosses the arbitrary-key cap and vanishes.
 *
 * A cap still bounds these — an unbounded accumulator would grow the row
 * without limit — but at the metadata cap, not the much tighter arbitrary one.
 *
 * Past that ceiling the value is truncated mid-array, and the union restarts
 * from the next span. That reset is not a property of truncation on its own —
 * it is enforced by `parseJsonStringArray`, which returns `[]` rather than its
 * lenient `[raw]` for a value that opens with `[` and does not close with `]`.
 * Without that guard the fragment came back as a single fake element and was
 * re-escaped into a fresh array on the next write, nesting one level deeper on
 * every read-back cycle. The durable fix for the cap itself is still a typed
 * column with an element cap. No column in this row has one yet —
 * `AnnotationIds` is an uncapped `Array(String)` and the fold appends to it
 * unbounded — so there is no precedent here to copy, only the same debt in a
 * second place.
 */
const FOLD_ACCUMULATOR_KEYS: ReadonlySet<string> = new Set(["langwatch.prompt_ids"]);

function isBlocklisted(key: string): boolean {
  if (PAYLOAD_BLOCKLIST_EXACT.has(key)) return true;
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
    if (key.startsWith(RESERVED_PREFIX) || FOLD_ACCUMULATOR_KEYS.has(key)) {
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
