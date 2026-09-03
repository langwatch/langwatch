/**
 * Span-attribute markers a privacy pass leaves behind, so a reader can tell
 * what was removed and what was only partly removed.
 *
 * A marker is the ONLY trace of a pass that ran: redaction happens at
 * ingestion and the original is never stored, so a span that reaches the
 * drawer carries no other evidence. That makes the attribute NAME a wire
 * format between whichever process wrote the span and every reader of it.
 *
 * The application's copy is
 * `platform/app/src/server/data-privacy/dropKeyCatalog.ts`, which stays as it
 * is while both graphs ingest. The value here is pinned to that one by literal
 * in `__tests__/data-privacy.markers.unit.test.ts` rather than read from it: a
 * process stamping `langwatch.privacy.pii_incomplete` while the read path
 * looks for a differently-spelled key would present a partly-redacted span as
 * fully scrubbed, and nothing would fail.
 */

/**
 * Stamped on a span when strict PII redaction was requested but the analysis
 * service (names, locations) could not run, so the native essential floor is
 * all that was applied. Lets the read path tell the viewer the deep redaction
 * did not complete instead of presenting the content as fully scrubbed. The
 * value is the level that was requested ("strict").
 */
export const PRIVACY_PII_INCOMPLETE_MARKER_ATTR = "langwatch.privacy.pii_incomplete";

/**
 * Stamped on a span whose content was dropped by a `drop` CATEGORY, so the UI
 * can explain the absence. The value is the dropped categories, comma-joined,
 * in the catalog's own order.
 */
export const PRIVACY_DROPPED_MARKER_ATTR = "langwatch.privacy.dropped";

/**
 * Stamped on a span whose attributes were dropped by custom attribute rules,
 * listing the dropped key NAMES (never the values) so the trace view can
 * explain the absence. Capped to keep the marker small.
 */
export const PRIVACY_DROPPED_ATTRIBUTES_MARKER_ATTR = "langwatch.privacy.dropped_attributes";
export const DROPPED_ATTRIBUTES_MARKER_MAX_KEYS = 20;
