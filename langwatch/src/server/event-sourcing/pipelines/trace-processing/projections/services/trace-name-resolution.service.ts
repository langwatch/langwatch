import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";

interface ResolvedTraceName {
  traceName: string;
  rootSpanType: string | null;
  rootSpanStartTimeMs: number | undefined;
  /**
   * Whether the resolved name came from the fallback path (earliest
   * span seen, no real root present) rather than a `parentSpanId ===
   * null` span. The fold projection uses this to know whether a later
   * arriving real root may supersede the current name.
   */
  traceNameFromFallback: boolean;
}

/**
 * Owns the precedence rules for the trace's user-facing name and the
 * canonical "root span" metadata derived from incoming spans.
 *
 * Rules:
 *   1. Trace name is sticky once set FROM A REAL ROOT — a span with
 *      `parentSpanId === null` (or from a user `TraceNameChanged`
 *      event). Subsequent root spans never overwrite a non-empty
 *      real-root name.
 *   2. Fallback name (no real root, earliest span wins) is *only*
 *      sticky against later non-root spans that started later. A real
 *      root span arriving at any point clears the fallback flag and
 *      takes over.
 *   3. Canonical root selection (the source of `rootSpanType` /
 *      `rootSpanStartTimeMs`) follows this precedence:
 *        - no canonical root yet → claim
 *        - earlier-named root arrives → rotate to the truly earlier one
 *        - empty-named placeholder still claimed → upgrade when a real
 *          name finally arrives, even if later in time
 *      The decision is gated on `rootSpanStartTimeMs`, NOT on
 *      `traceName` — so a rename event landing before any root doesn't
 *      freeze out later root-span discoveries.
 *   4. Fallback path: when a span arrives with a non-null parent
 *      (typical) and the trace either has no name yet OR is sitting on
 *      a fallback name from an earlier non-root span, pick the
 *      earliest-by-start span as the trace name. This recovers traces
 *      where customers emit the first span with a bogus
 *      `parent_span_id` — without this, the trace would never get a
 *      name at all because no span ever satisfies
 *      `parentSpanId === null`.
 */
export class TraceNameResolutionService {
  resolveFromSpan({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): ResolvedTraceName {
    const fromFallback = state.traceNameFromFallback ?? false;
    const unchanged: ResolvedTraceName = {
      traceName: state.traceName,
      rootSpanType: state.rootSpanType,
      rootSpanStartTimeMs: state.rootSpanStartTimeMs,
      traceNameFromFallback: fromFallback,
    };

    const isRootSpan = span.parentSpanId === null;
    const spanStartMs = span.startTimeUnixMs;
    const spanType = String(span.spanAttributes[ATTR_KEYS.SPAN_TYPE] ?? "");

    if (isRootSpan) {
      const currentRootStartMs = state.rootSpanStartTimeMs;
      const haveCanonicalRoot = currentRootStartMs !== undefined;
      const isEarlierNamedRoot =
        span.name !== "" &&
        haveCanonicalRoot &&
        spanStartMs < currentRootStartMs;
      const upgradesEmptyNamedRoot =
        haveCanonicalRoot && state.traceName === "" && span.name !== "";

      // A real root always wins over a fallback name from an earlier
      // non-root span. Force a take-over when the current name is from
      // the fallback path even if we already had a fallback "canonical
      // root" recorded.
      if (
        fromFallback ||
        !haveCanonicalRoot ||
        isEarlierNamedRoot ||
        upgradesEmptyNamedRoot
      ) {
        return {
          traceName:
            fromFallback || state.traceName === ""
              ? span.name
              : state.traceName,
          rootSpanType: spanType || null,
          rootSpanStartTimeMs: spanStartMs,
          traceNameFromFallback: false,
        };
      }

      return unchanged;
    }

    // Non-root span. Only the fallback path can update from here, and
    // only if (a) we've never had a real root, and (b) this is now the
    // earliest-starting span we've seen.
    const haveRealRoot = !fromFallback && state.rootSpanStartTimeMs !== undefined;
    if (haveRealRoot) return unchanged;
    // A user-overridden name is final; don't let the fallback path
    // overwrite it even when no real root exists. The user explicitly
    // told us what to call this trace.
    if (state.traceNameUserOverridden) return unchanged;

    const currentStartMs = state.rootSpanStartTimeMs;
    const isFirstFallback = currentStartMs === undefined;
    const isEarlierThanCurrentFallback =
      currentStartMs !== undefined && spanStartMs < currentStartMs;
    // Same span re-arriving (or a different span at the same start)
    // shouldn't ping-pong the name once we've claimed one — only a
    // strictly-earlier start dethrones the current fallback.
    if (!isFirstFallback && !isEarlierThanCurrentFallback) return unchanged;
    // The fallback is supposed to be the *trace's* working name, not
    // a placeholder of nothing. If the candidate span itself has no
    // name (empty string) and we already have a name, keep the name.
    const candidateNameIsBetter =
      state.traceName === "" || span.name !== "";
    if (!candidateNameIsBetter) return unchanged;

    return {
      traceName: span.name || state.traceName,
      rootSpanType: spanType || null,
      rootSpanStartTimeMs: spanStartMs,
      traceNameFromFallback: true,
    };
  }
}
