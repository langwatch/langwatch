/**
 * The onboarding tour renders a handful of fabricated traces so a project with
 * no data still has something to click. Their ids carry a prefix, and every
 * read path checks for it before asking the server for a trace that does not
 * exist.
 *
 * The prefix and its test live here rather than beside the sample data because
 * the stores and hooks that gate on it must not pull the sample payloads (and
 * the onboarding component graph behind them) into their own import graph.
 */
const PREVIEW_TRACE_ID_PREFIX = "lw-preview-";

/** The id a preview trace is minted with, for a given sample id. */
export function previewTraceId(id: string): string {
  return `${PREVIEW_TRACE_ID_PREFIX}${id}`;
}

/** True when the id names a fabricated onboarding trace, not a stored one. */
export function isPreviewTraceId(traceId: string): boolean {
  return traceId.startsWith(PREVIEW_TRACE_ID_PREFIX);
}
