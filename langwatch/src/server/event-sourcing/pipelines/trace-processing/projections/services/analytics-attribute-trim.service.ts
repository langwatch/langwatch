/**
 * Heuristic Attributes-map trimmer for the slim trace_analytics fold (ADR-034
 * Phase 2). Run at WRITE time so the slim row's Attributes map carries only
 * what makes sense for analytics scans.
 *
 * Why a separate function (and not "just write the same Attributes map"): the
 * trace_summaries fold accumulates the FULL attribute set per trace — every
 * canonicalised span attribute, every metadata.*, every per-span lifted key.
 * That makes trace_summaries a good drawer-detail source, but a bad analytics
 * scan target: ~half the bytes are payload (gen_ai.prompt, gen_ai.completion,
 * extracted message arrays). Slim must be GENUINELY slim — drop those at fold
 * time and keep only what an analytics dimension query could meaningfully
 * filter on.
 *
 * The contract:
 *
 *   * `metadata.*` keys are ALWAYS kept (user-defined dimensions; the entire
 *     point of metadata is to be filterable). Hard cap on the VALUE at 4096
 *     chars so a stray JSON-blob value can't blow up rows — when longer, we
 *     truncate to 4096 chars and append a visible ellipsis so the truncation
 *     is observable in the row, not hidden.
 *
 *   * `langwatch.reserved.*` keys are ALWAYS kept, but under the same 4096-char
 *     value cap as `metadata.*` (same truncation-with-ellipsis behaviour). The
 *     platform computes these (TraceAttributeAccumulationService and the fold
 *     itself), but the schema has no enforced length constraint — a future
 *     extractor lifting a long-form value into a reserved key would otherwise
 *     bypass the bound. Cap protects against that without dropping the key.
 *
 *   * Any OTHER key is kept iff its value length ≤ 256 chars. 256 is wide
 *     enough for ids / model names / version strings / agent names / tool
 *     names / provider names — the things an analytics query might group or
 *     filter on. Past 256 the value is overwhelmingly a payload artifact.
 *
 *   * BLOCKLIST: keys explicitly known to carry payload regardless of length
 *     are dropped unconditionally. The list is derived from the
 *     canonicalisation extractors + span-cost services (everything that
 *     SDKs use to carry user/model conversation text). Adding to the list
 *     is a one-line patch when a new instrumentation lands.
 *
 * The function is pure: it takes a string→string map (the post-accumulation
 * shape stored on TraceSummaryData.attributes) and returns a NEW map with the
 * same keys minus the dropped ones plus any truncated values. Caller owns the
 * input map; mutation is intentionally avoided to keep the trim auditable in
 * isolation.
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
export function trimAttributesForAnalytics(
  attrs: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value !== "string") continue;
    if (isBlocklisted(key)) continue;

    if (key.startsWith(METADATA_PREFIX)) {
      out[key] = truncateWithEllipsis(value, ANALYTICS_METADATA_VALUE_CAP);
      continue;
    }
    if (key.startsWith(RESERVED_PREFIX)) {
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
