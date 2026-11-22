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
  /**
   * Over-plan withholding (specs/billing/over-plan-trace-withholding.feature): traces started
   * at or after this epoch-ms cutoff are stored but not listed or opened. `null` = nothing held.
   */
  withheldFromMs?: number | null;
  /** The member counts behind `withheldFromMs`, for the traces page line. */
  overPlan?: { members: number; maxMembers: number } | null;
}

/** What the viewer's plan withholds: nothing, or every trace started at or after `fromMs`. */
export type TraceWithholding =
  | { kind: "none" }
  | { kind: "over_plan"; fromMs: number; members: number; maxMembers: number };

export const traceWithholdingOf = (protections: Protections): TraceWithholding =>
  protections.withheldFromMs === null || protections.withheldFromMs === undefined
    ? { kind: "none" }
    : {
        kind: "over_plan",
        fromMs: protections.withheldFromMs,
        members: protections.overPlan?.members ?? 0,
        maxMembers: protections.overPlan?.maxMembers ?? 0,
      };

/** Whether a trace that started at `startedAtMs` is withheld by an over-plan cutoff. */
export const isTraceWithheld = ({
  startedAtMs,
  withheldFromMs,
}: {
  startedAtMs: number;
  withheldFromMs: number | null | undefined;
}): boolean =>
  withheldFromMs !== null && withheldFromMs !== undefined && startedAtMs >= withheldFromMs;

/**
 * Whether this viewer may read text the model wrote from the conversation, rather than a fact
 * about it. Both sides are required: summaries, titles and evaluator prose paraphrase prompt
 * and reply together, so one-sided access would leak the other. Every surface asks here.
 */
export const canReadCapturedContent = (protections: Protections): boolean =>
  protections.canSeeCapturedInput === true && protections.canSeeCapturedOutput === true;
