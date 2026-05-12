import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

interface ResolvedTraceName {
  traceName: string;
  rootSpanType: string | null;
  rootSpanStartTimeMs: number | undefined;
}

/**
 * Owns the precedence rules for the trace's user-facing name and the
 * canonical "root span" metadata derived from incoming spans.
 *
 * Rules:
 *   1. Trace name is sticky once set — whether the name came from a
 *      root span OR from a user `TraceNameChanged` event. Subsequent
 *      root spans never overwrite a non-empty name.
 *   2. Canonical root selection (the source of `rootSpanType` /
 *      `rootSpanStartTimeMs`) follows this precedence:
 *        - no canonical root yet → claim
 *        - earlier-named root arrives → rotate to the truly earlier one
 *        - empty-named placeholder still claimed → upgrade when a real
 *          name finally arrives, even if later in time
 *      The decision is gated on `rootSpanStartTimeMs`, NOT on
 *      `traceName` — so a rename event landing before any root doesn't
 *      freeze out later root-span discoveries.
 */
export class TraceNameResolutionService {
  resolveFromSpan({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): ResolvedTraceName {
    const unchanged: ResolvedTraceName = {
      traceName: state.traceName,
      rootSpanType: state.rootSpanType,
      rootSpanStartTimeMs: state.rootSpanStartTimeMs,
    };

    const isRootSpan = span.parentSpanId === null;
    if (!isRootSpan) return unchanged;

    const spanStartMs = span.startTimeUnixMs;
    const spanType = String(span.spanAttributes[ATTR_KEYS.SPAN_TYPE] ?? "");
    const currentRootStartMs = state.rootSpanStartTimeMs;
    const haveCanonicalRoot = currentRootStartMs !== undefined;
    const isEarlierNamedRoot =
      span.name !== "" &&
      haveCanonicalRoot &&
      spanStartMs < currentRootStartMs;
    const upgradesEmptyNamedRoot =
      haveCanonicalRoot && state.traceName === "" && span.name !== "";

    if (!haveCanonicalRoot || isEarlierNamedRoot || upgradesEmptyNamedRoot) {
      return {
        traceName: state.traceName === "" ? span.name : state.traceName,
        rootSpanType: spanType || null,
        rootSpanStartTimeMs: spanStartMs,
      };
    }

    return unchanged;
  }
}
