/**
 * What a usage counter returns when it could not count.
 *
 * The counting services used to answer `0` for this and call it "fail-open",
 * which conflated two states a caller must tell apart: an organization that
 * genuinely sent nothing this month, and ClickHouse being unreachable. Every
 * consumer then read the second as the first — limit enforcement saw an
 * organization comfortably inside its cap, the usage-limit notifier saw nobody
 * worth warning, and the usage page rendered a confident `0`. An outage in the
 * counting store silently switched off metering and told customers their usage
 * had vanished.
 *
 * Fail-open was the right INSTINCT: an outage on our side should not lock a
 * paying customer out of their own product. It was the wrong mechanism, because
 * a fabricated number cannot be distinguished from a real one downstream, so
 * the decision to let traffic through was made implicitly, in a service that
 * had no business making it, and was invisible everywhere it took effect.
 *
 * `"unknown"` moves that decision to the callers, where it can be made
 * differently for each: enforcement still lets traffic through, but says so out
 * loud; the notifier skips the run rather than emailing about a number it does
 * not have; display shows that the figure is unavailable instead of asserting
 * zero.
 *
 * Deliberately a sentinel rather than `null` or a thrown error. It matches
 * `"unlimited"`, which already rides these same return types for "not counted,
 * for a different reason", so callers narrow both the same way and the
 * typechecker makes anyone adding a consumer decide what to do about it.
 */
export const USAGE_UNKNOWN = "unknown" as const;

/** A usage count, or {@link USAGE_UNKNOWN} when it could not be determined. */
export type UsageCount = number | typeof USAGE_UNKNOWN;

/** Per-project counts, or {@link USAGE_UNKNOWN} when the query could not run. */
export type ProjectUsageCounts =
  | Array<{ projectId: string; count: number }>
  | typeof USAGE_UNKNOWN;
