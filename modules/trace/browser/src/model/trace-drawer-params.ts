import { isPreviewTraceId } from "./preview-trace-id.ts";

export type DrawerViewMode = "trace" | "summary" | "conversation" | "terminal" | "session";
// Flame's time-weighted blocks show where time is spent better than the indented waterfall does.
export type VizTab = "waterfall" | "topology" | "sequence" | "flame";

/** The drawer name the trace drawer registers under, and so the address it lives at. */
export const TRACE_DRAWER_NAME = "traceV2Details";

/** The view a trace opens on when neither the link nor the reader's last choice names one. */
export const DEFAULT_VIEW_MODE: DrawerViewMode = "summary";
export const DEFAULT_VIZ_TAB: VizTab = "waterfall";

/** Hard cap on the number of pinned span tabs. */
export const MAX_PINNED_SPANS = 8;

export function isViewMode(value: string | null | undefined): value is DrawerViewMode {
  // `terminal` and `session` belong here too: they are real modes, and leaving
  // them out meant a shared `?mode=terminal` link quietly opened on Trace
  // instead — the link looked like it worked, and landed somewhere else.
  return (
    value === "trace" ||
    value === "summary" ||
    value === "conversation" ||
    value === "terminal" ||
    value === "session"
  );
}

function isVizTab(value: string | null | undefined): value is VizTab {
  return value === "waterfall" || value === "topology" || value === "sequence" || value === "flame";
}

/**
 * Views that replay an agent run rather than showing the trace's own spans. There is
 * nothing in them to correct and nothing to point a comment at, so annotation mode
 * never renders one.
 */
const UNEDITABLE_VIEW_MODES = new Set<DrawerViewMode>(["terminal", "session"]);

export function isUneditableViewMode(mode: DrawerViewMode): boolean {
  return UNEDITABLE_VIEW_MODES.has(mode);
}

/**
 * The view a link resolves to. A link can name a view and edit mode at once,
 * and the two can disagree; the correction wins, because rendering a pane the
 * reviewer cannot correct is a drawer that says it is editing and is not.
 */
export function viewModeForEditState({
  viewMode,
  isEditing,
}: {
  viewMode: DrawerViewMode;
  isEditing: boolean;
}): DrawerViewMode {
  return isEditing && isUneditableViewMode(viewMode) ? "trace" : viewMode;
}

/** Whether a `drawer.t` link value is a usable timestamp: a positive whole number. */
export function isOccurredAtParam(raw: string | null | undefined): raw is string {
  return typeof raw === "string" && /^[1-9]\d*$/.test(raw);
}

/** Parse the `drawer.edit` URL param. */
export function parseEditParam({
  raw,
  traceId,
}: {
  raw: string | null | undefined;
  traceId: string | null | undefined;
}): boolean {
  if (raw !== "1") return false;
  if (!traceId) return false;
  return !isPreviewTraceId(traceId);
}

/**
 * Parse the `drawer.pinnedSpans` URL param into a deduplicated, capped
 * id list. Empty / malformed values become `[]` rather than throwing so
 * a bad query string can't break drawer hydration.
 */
function parsePinnedSpansParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= MAX_PINNED_SPANS) break;
  }
  return out;
}

/** Inverse of {@link parsePinnedSpansParam}: serialises for the URL. */
export function serializePinnedSpansParam(ids: readonly string[]): string | undefined {
  if (ids.length === 0) return undefined;
  return ids.slice(0, MAX_PINNED_SPANS).join(",");
}

/** What the address says about the open trace drawer, before any default is applied. */
export interface TraceDrawerAddress {
  isOpen: boolean;
  traceId: string | null;
  projectId: string | null;
  occurredAtMs: number | null;
  selectedSpanId: string | null;
  pinnedSpanIds: string[];
  isEditing: boolean;
  addressedViewMode: DrawerViewMode | null;
  addressedVizTab: VizTab | null;
}

const CLOSED: TraceDrawerAddress = {
  isOpen: false,
  traceId: null,
  projectId: null,
  occurredAtMs: null,
  selectedSpanId: null,
  pinnedSpanIds: [],
  isEditing: false,
  addressedViewMode: null,
  addressedVizTab: null,
};

/** Reads the trace drawer out of a flat `drawer.*` query; any other open drawer reads as closed. */
export function readTraceDrawerAddress(
  query: Readonly<Record<string, string | undefined>>,
): TraceDrawerAddress {
  const traceId = query["drawer.traceId"] || null;
  if (query["drawer.open"] !== TRACE_DRAWER_NAME || traceId === null) return CLOSED;
  const occurredAt = query["drawer.t"];
  const mode = query["drawer.mode"];
  const viz = query["drawer.viz"];
  return {
    isOpen: true,
    traceId,
    projectId: query["drawer.projectId"] || null,
    occurredAtMs: isOccurredAtParam(occurredAt) ? Number(occurredAt) : null,
    selectedSpanId: query["drawer.span"] || null,
    pinnedSpanIds: parsePinnedSpansParam(query["drawer.pinnedSpans"]),
    isEditing: parseEditParam({ raw: query["drawer.edit"], traceId }),
    addressedViewMode: isViewMode(mode) ? mode : null,
    addressedVizTab: isVizTab(viz) ? viz : null,
  };
}
