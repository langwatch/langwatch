/**
 * The onboarding tour renders a handful of fabricated traces so a project with no data
 * still has something to click. Their ids carry a prefix, and every read path checks
 * for it before asking the server for a trace that does not exist.
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
