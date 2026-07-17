/**
 * Read-time offloaded-IO detection + overlay decision (ADR-022 / #5835).
 *
 * Shared by `TraceSummaryService.getByTraceId` (single-trace read) and
 * `TraceListService`'s `resolveFullIO` path (bulk read) — both restore a
 * trace's full computed input/output from event_log and flag any field whose
 * eventref could not be resolved, via the exact same rule. Lifted out of the
 * two services so the "content may be incomplete" logic lives in exactly one
 * place instead of two parallel copies.
 */
import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { hasEventRefs, parseSpanEventRefs } from "./offloaded-eventref-parsing";
import type { ResolvedTraceSpans } from "./resolve-offloaded-traces";

/**
 * IO attribute keys that can carry an ADR-022 eventref (mirrors
 * `lean-for-projection`'s `IO_ATTR_KEYS`, split by direction). Used to attribute
 * an unresolved eventref to the input vs output field for the best-effort
 * "content may be incomplete" signal (#5835 AC4).
 */
const INPUT_IO_ATTR_KEYS: ReadonlySet<string> = new Set([
  ATTR_KEYS.LANGWATCH_INPUT,
  ATTR_KEYS.GEN_AI_INPUT_MESSAGES,
]);
const OUTPUT_IO_ATTR_KEYS: ReadonlySet<string> = new Set([
  ATTR_KEYS.LANGWATCH_OUTPUT,
  ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES,
]);

/**
 * Detects which trace-level IO directions carried an ADR-022 eventref, decoding
 * pointers through the shared {@link parseSpanEventRefs} so the eventref shape is
 * parsed in exactly one place.
 *
 * Best-effort across ALL spans (not just the fold's winner): computing the
 * winner here would duplicate the fold's selection algorithm. Over-flagging is
 * bounded to the rare shape where a non-winning span's ref fails while the
 * winning span's value was complete — acceptable for a narrow "may be
 * incomplete" hint. `missingEventIdKeys` and `malformedKeys` count too: a ref
 * with no usable eventId, or whose value is not valid JSON, cannot be resolved,
 * so its field is likewise still a preview.
 */
export function detectOffloadedIOFields(spans: NormalizedSpan[]): {
  inputHadRef: boolean;
  outputHadRef: boolean;
} {
  let inputHadRef = false;
  let outputHadRef = false;
  for (const span of spans) {
    const attrs = span.spanAttributes as Record<string, string>;
    if (!hasEventRefs(attrs)) continue;
    const { eventrefEntries, missingEventIdKeys, malformedKeys } =
      parseSpanEventRefs(attrs);
    const refAttrKeys = [
      ...eventrefEntries.map((entry) => entry.attrKey),
      ...missingEventIdKeys,
      ...malformedKeys,
    ];
    for (const attrKey of refAttrKeys) {
      if (INPUT_IO_ATTR_KEYS.has(attrKey)) inputHadRef = true;
      else if (OUTPUT_IO_ATTR_KEYS.has(attrKey)) outputHadRef = true;
    }
  }
  return { inputHadRef, outputHadRef };
}

/**
 * Overlays a single trace's resolved full IO onto its summary row and flags any
 * field whose eventref failed to resolve. `originalSpans` are the RAW spans
 * (refs intact) so `detectOffloadedIOFields` can see which directions carried a
 * ref — the resolved spans folded into `resolved` have those keys stripped.
 *
 * Invariants: overlay the recomputed value only when a span actually resolved
 * AND the recompute was non-null (else keep the stored preview); a field is
 * `*Truncated` exactly when (1) it HAD a ref, (2) a stored preview exists
 * (non-null), and (3) no resolution succeeded at all (`anyResolved=false`).
 * When `anyResolved=true`, we cannot distinguish "fold-excluded span with
 * resolved ref" from "winner span's ref failed", so we conservatively avoid
 * false-positive truncation warnings in ambiguous cases.
 */
export function overlayResolvedIO({
  stored,
  originalSpans,
  resolved,
}: {
  stored: TraceSummaryData;
  originalSpans: NormalizedSpan[];
  resolved: ResolvedTraceSpans;
}): TraceSummaryData {
  const { inputHadRef, outputHadRef } = detectOffloadedIOFields(originalSpans);
  const { recomputedInput, recomputedOutput, anyResolved } = resolved;

  const out: TraceSummaryData = { ...stored };

  if (anyResolved) {
    if (recomputedInput !== null) out.computedInput = recomputedInput.text;
    if (recomputedOutput !== null) out.computedOutput = recomputedOutput.text;
  }

  if (inputHadRef && stored.computedInput !== null && !anyResolved) {
    out.inputTruncated = true;
  }
  if (outputHadRef && stored.computedOutput !== null && !anyResolved) {
    out.outputTruncated = true;
  }

  return out;
}
