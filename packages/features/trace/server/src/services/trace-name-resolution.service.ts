import { ATTR_KEYS, type NormalizedSpan, type TraceSummaryData } from "@langwatch/trace-contract";

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
  /**
   * Whether `rootSpanType` / `rootSpanStartTimeMs` were claimed via
   * the fallback path. Tracked separately from
   * `traceNameFromFallback` so a user rename can disown the name's
   * fallback provenance without locking in a non-root span as the
   * canonical root metadata.
   */
  rootMetadataFromFallback: boolean;
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
 *   5. Name and root-metadata provenance diverge after a user rename:
 *      `traceNameFromFallback` clears (the user-supplied name is no
 *      longer "fallback-sourced"), but `rootMetadataFromFallback`
 *      stays true so a real root arriving later can still upgrade the
 *      canonical metadata. Without this split, a rename in step 2
 *      would freeze `rootSpanStartTimeMs` to the fallback span and
 *      block the metadata upgrade on later real roots that started
 *      after the fallback span.
 */
export class TraceNameResolutionService {
  private constructor() {}

  static create(): TraceNameResolutionService {
    return new TraceNameResolutionService();
  }

  resolveFromSpan({
    state,
    span,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
  }): ResolvedTraceName {
    const nameFromFallback = state.traceNameFromFallback ?? false;
    const metadataFromFallback = state.rootMetadataFromFallback ?? nameFromFallback;
    const unchanged: ResolvedTraceName = {
      traceName: state.traceName,
      rootSpanType: state.rootSpanType,
      rootSpanStartTimeMs: state.rootSpanStartTimeMs,
      traceNameFromFallback: nameFromFallback,
      rootMetadataFromFallback: metadataFromFallback,
    };

    const isRootSpan = span.parentSpanId === null;
    const spanStartMs = span.startTimeUnixMs;
    const spanType = String(span.spanAttributes[ATTR_KEYS.SPAN_TYPE] ?? "");

    return isRootSpan
      ? this.fromRealRoot({
          state,
          span,
          spanType,
          spanStartMs,
          nameFromFallback,
          metadataFromFallback,
          unchanged,
        })
      : this.fromFallbackCandidate({
          state,
          span,
          spanType,
          spanStartMs,
          metadataFromFallback,
          unchanged,
        });
  }

  /** Rule 1 and rule 3: a span with no parent, and what it may take over. */
  private fromRealRoot({
    state,
    span,
    spanType,
    spanStartMs,
    nameFromFallback,
    metadataFromFallback,
    unchanged,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    spanType: string;
    spanStartMs: number;
    nameFromFallback: boolean;
    metadataFromFallback: boolean;
    unchanged: ResolvedTraceName;
  }): ResolvedTraceName {
    const currentRootStartMs = state.rootSpanStartTimeMs;
    const haveCanonicalRoot = currentRootStartMs !== undefined;
    const isEarlierNamedRoot =
      span.name !== "" && haveCanonicalRoot && spanStartMs < currentRootStartMs;
    const upgradesEmptyNamedRoot = haveCanonicalRoot && state.traceName === "" && span.name !== "";

    // A real root always wins over fallback metadata. The takeover is gated on
    // `metadataFromFallback`, NOT `nameFromFallback` — a user rename clears the
    // name flag but leaves the metadata still fallback-sourced, and a real
    // root's metadata should still land in that case.
    const claimsMetadata =
      metadataFromFallback || !haveCanonicalRoot || isEarlierNamedRoot || upgradesEmptyNamedRoot;
    if (!claimsMetadata) return unchanged;

    // The name only takes over when the NAME itself was still fallback-sourced
    // (or empty). A user-supplied name survives a metadata upgrade — the user's
    // intent overrides the discovery.
    const nameTakesOver = nameFromFallback || state.traceName === "";

    return {
      traceName: nameTakesOver ? span.name : state.traceName,
      rootSpanType: spanType || null,
      rootSpanStartTimeMs: spanStartMs,
      traceNameFromFallback: false,
      rootMetadataFromFallback: false,
    };
  }

  /**
   * Rule 4: a span WITH a parent, which can only ever set the fallback name.
   *
   * This recovers traces where a customer emits their first span with a bogus
   * `parent_span_id` — without it the trace never gets a name at all, because
   * no span ever satisfies `parentSpanId === null`.
   */
  private fromFallbackCandidate({
    state,
    span,
    spanType,
    spanStartMs,
    metadataFromFallback,
    unchanged,
  }: {
    state: TraceSummaryData;
    span: NormalizedSpan;
    spanType: string;
    spanStartMs: number;
    metadataFromFallback: boolean;
    unchanged: ResolvedTraceName;
  }): ResolvedTraceName {
    const currentStartMs = state.rootSpanStartTimeMs;

    // A real root has already spoken.
    if (!metadataFromFallback && currentStartMs !== undefined) return unchanged;
    // A user-overridden name is final, even with no real root: they told us
    // what to call this trace.
    if (state.traceNameUserOverridden) return unchanged;
    // Same span re-arriving, or another at the same start, must not ping-pong
    // the name — only a strictly earlier start dethrones the current fallback.
    if (currentStartMs !== undefined && spanStartMs >= currentStartMs) return unchanged;
    // The fallback is the trace's working name, not a placeholder of nothing.
    if (state.traceName !== "" && span.name === "") return unchanged;

    return {
      traceName: span.name || state.traceName,
      rootSpanType: spanType || null,
      rootSpanStartTimeMs: spanStartMs,
      traceNameFromFallback: true,
      rootMetadataFromFallback: true,
    };
  }
}
