/**
 * Span-attribute markers a privacy pass leaves behind, so readers can tell
 * what was removed and what was only partly removed. Attribute names are wire
 * formats; pinned against platform/app's version by tests.
 */

/**
 * Stamped on a span when strict PII redaction was requested but the
 * analysis service (names, locations) couldn't run, so only the essential
 * floor applied — flags this as incomplete rather than fully scrubbed.
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
