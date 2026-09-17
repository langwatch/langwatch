/**
 * Named here rather than imported from the data-privacy contract: these are
 * the categories the READ path reasons about, and a contract that imports
 * another contract chains the build. Same four words, two bounded contexts.
 */
const CONTENT_CATEGORIES = ["input", "output", "system", "tools"] as const;
type ContentCategory = (typeof CONTENT_CATEGORIES)[number];

/**
 * Read-time visibility for one content category (input / output / system
 * instructions / tool calls) for THIS viewer.
 */
export interface CategoryVisibility {
  /** Whether the viewer may read this category's content. */
  canSee: boolean;
  /**
   * Audience label for `restrict` rules ("Admins" or "no one"), shown on
   * placeholders and in-audience viewers. Null for plain capture.
   */
  restrictVisibleTo: string | null;
}

export interface Protections {
  canSeeCosts?: boolean | undefined | null;
  canSeeCapturedInput?: boolean | undefined | null;
  canSeeCapturedOutput?: boolean | undefined | null;
  // When input/output is hidden by a `restrict` privacy policy, a human label of
  // who CAN see it (e.g. "Admins, Security group"), for the trace-view
  // placeholder. Null/absent when the content is visible.
  capturedInputVisibleTo?: string | null;
  capturedOutputVisibleTo?: string | null;
  // Per-category read-time visibility for ALL four content categories, so the
  // trace view can present each one consistently (the `canSee*`/`captured*`
  // fields above are the input/output projection kept for legacy readers).
  // System instructions and tool calls live inside the captured conversation,
  // so the V2 read path strips their turns when `system`/`tools` is not visible.
  contentCategories?: Record<ContentCategory, CategoryVisibility>;
  // Custom attribute rules (restrict disposition) whose audience excludes THIS
  // viewer: the read mappers replace matching attribute values with a redaction
  // placeholder naming `visibleTo`. Patterns may carry `*` wildcards. Absent or
  // empty when nothing is hidden for the viewer.
  hiddenAttributes?: { pattern: string; visibleTo: string }[];
  // ALL custom-attribute `restrict` rules the read path surfaces (not only the ones
  // hidden from this viewer), each with whether THIS viewer may read a matching value.
  // The trace view marks matching rows and tells an in-audience viewer (`canSee: true`)
  // which audience the attribute is limited to; `hiddenAttributes` is the `canSee: false`
  // subset for the redaction mappers. Patterns may carry `*` wildcards.
  restrictedAttributes?: {
    pattern: string;
    visibleTo: string;
    canSee: boolean;
  }[];
  /**
   * Plan-based visibility window: traces/spans started before this epoch-ms
   * cutoff get their content teaser-redacted. `null`/`undefined` = no window
   * (paid/licensed plans, internal reads).
   */
  visibilityCutoffMs?: number | null;
}
