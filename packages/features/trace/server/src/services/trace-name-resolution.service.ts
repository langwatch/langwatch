import { ATTR_KEYS, type NormalizedSpan, type TraceSummaryData } from "@langwatch/trace-contract";

interface ResolvedTraceName {
  traceName: string;
  rootSpanType: string | null;
  rootSpanStartTimeMs: number | undefined;
  /**
   * Whether the resolved name came from the fallback path, the earliest span seen with no real
   * root present, rather than a `parentSpanId === null` span. The fold projection reads this to
   * know whether a later real root may supersede the current name.
   */
  traceNameFromFallback: boolean;
  /**
   * Whether `rootSpanType` and `rootSpanStartTimeMs` were claimed via the fallback path. Tracked
   * apart from `traceNameFromFallback` so a user rename can disown the name's provenance without
   * locking a non-root span in as the canonical root metadata.
   */
  rootMetadataFromFallback: boolean;
}

/**
 * Owns the precedence rules for a trace's user-facing name and its canonical root-span metadata. A
 * name from a real root is sticky and a fallback name yields to any real root; canonical root
 * selection claims the first root and rotates only to a truly earlier one.
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
    if (!claimsMetadata) {
      return unchanged;
    }

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
   * A span with a parent, which can only ever set the fallback name. It recovers traces whose
   * first span carries a bogus `parent_span_id`: without it such a trace never gets a name, since
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
    if (!metadataFromFallback && currentStartMs !== undefined) {
      return unchanged;
    }

    // A user-overridden name is final, even with no real root: they told us
    // what to call this trace.
    if (state.traceNameUserOverridden) {
      return unchanged;
    }

    // Same span re-arriving, or another at the same start, must not ping-pong
    // the name — only a strictly earlier start dethrones the current fallback.
    if (currentStartMs !== undefined && spanStartMs >= currentStartMs) {
      return unchanged;
    }

    // The fallback is the trace's working name, not a placeholder of nothing.
    if (state.traceName !== "" && span.name === "") {
      return unchanged;
    }

    return {
      traceName: span.name || state.traceName,
      rootSpanType: spanType || null,
      rootSpanStartTimeMs: spanStartMs,
      traceNameFromFallback: true,
      rootMetadataFromFallback: true,
    };
  }
}
