import { create, type StoreApi } from "zustand";
import type { SpanInputOutput, SpanTypes } from "@langwatch/trace-contract";
import {
  encodeSpanIOFromEditedText,
  stringifySpanIO,
  TRACE_EDIT_OVERLAY_PATCH_VERSION,
  type TraceEditOverlayPatch,
  type TraceEditSpanPatch,
} from "@langwatch/trace-contract";

/**
 * Which trace the reader is looking at: the corrected one or the one that was
 * captured. Only meaningful once a correction exists.
 */
export type TraceOverlayView = "edited" | "original";

/** The trace-metadata half of a correction: an overlay, a clear, or nothing. */
type TraceMetadataEdits = NonNullable<TraceEditOverlayPatch["trace"]>["metadata"];

/**
 * One edited input or output. The drawer only ever sees a rendered string, so
 * the text it was seeded from travels alongside the edited text: a value that
 * was never structured stays unstructured when it is encoded back into the
 * correction, instead of a typed number or object appearing where the trace
 * held prose.
 */
export interface SpanIODraft {
  text: string;
  baselineText: string | null;
}

/**
 * The uncommitted changes to one span. Every key is optional and only present
 * once the reviewer has actually touched that field, which is what keeps "has
 * anything changed" a question about presence.
 */
export interface SpanEditDraft {
  name?: string;
  type?: SpanTypes;
  input?: SpanIODraft;
  output?: SpanIODraft;
  /**
   * The attributes the overrides below apply on top of, snapshotted the first
   * time an attribute is edited. A correction replaces the whole attribute
   * record, so the untouched keys have to travel with the edits.
   */
  paramsBase?: Record<string, unknown>;
  /** Per-key attribute overrides. A `null` value removes that key. */
  params?: Record<string, unknown>;
}

/** The fields of a span a reviewer edits directly in the drawer. */
export type SpanDraftField = "name" | "type" | "input" | "output";

/**
 * What the drawer should show for one span while it is being edited: the
 * correction already stored for it, with the reviewer's uncommitted changes on
 * top. Reading it rather than the captured span is what stops a second editing
 * session from quietly reverting the first one.
 */
export interface EffectiveSpanEdit {
  name?: string;
  type?: SpanTypes;
  input?: string;
  output?: string;
  params?: Record<string, unknown>;
}

interface TraceEditState {
  /** The trace being edited, or null when the drawer is only reading. */
  editingTraceId: string | null;
  /**
   * The correction already stored for this trace when editing started. Drafts
   * layer on top of it and the save merges the two, so correcting a trace a
   * second time adds to the first correction instead of replacing it.
   */
  basePatch: TraceEditOverlayPatch | null;
  spanDrafts: Record<string, SpanEditDraft>;
  /** Spans the reviewer deleted in this session. */
  deletedSpanIds: string[];
  /** Spans the stored correction deleted that the reviewer brought back. */
  restoredSpanIds: string[];
  traceInputDraft: SpanIODraft | null;
  traceOutputDraft: SpanIODraft | null;
  /**
   * Per-key overrides on the trace's own metadata, in the bare keys the
   * canonical trace metadata uses. A `null` value removes that key. Only the
   * keys the reviewer touched travel, so a correction to one label never
   * restates the rest of the map.
   */
  traceMetadataDrafts: Record<string, unknown>;
  overlayView: TraceOverlayView;
  /**
   * Something that wants to leave the trace (closing the drawer, opening
   * another trace) and is waiting on the reviewer to say what happens to their
   * unsaved work. Held rather than run so the confirmation and the action stay
   * one decision.
   */
  pendingExit: (() => void) | null;
  /**
   * Whether the full difference is open. Held here rather than in the button
   * that opens it because the hover on a corrected field also offers to open
   * it, and both must reach the same dialog.
   */
  diffOpen: boolean;

  requestExit: (run: () => void) => void;
  clearPendingExit: () => void;
  setDiffOpen: (open: boolean) => void;

  startEditing: (params: {
    traceId: string;
    basePatch?: TraceEditOverlayPatch | null;
  }) => void;
  /**
   * Records the stored correction once the read for it lands. Editing can
   * start before that read resolves (a link straight into edit mode), and this
   * is what keeps the session layered on the correction instead of replacing
   * it. Ignored once a baseline is set, so a refetch can never move the ground
   * under an edit in progress.
   */
  adoptBasePatch: (params: { traceId: string; basePatch: TraceEditOverlayPatch }) => void;
  /**
   * Moves the session onto the correction as it stands right now, however far
   * the session had already got. Used immediately before a save so a correction
   * stored while this one was being written is built on rather than replaced.
   */
  rebaseBasePatch: (params: {
    traceId: string;
    basePatch: TraceEditOverlayPatch;
  }) => void;
  stopEditing: () => void;
  /** Drops every uncommitted change and leaves edit mode. */
  discard: () => void;
  /**
   * Drops a session left behind on another trace. A session on the trace being
   * opened is left alone: a link straight into edit mode re-enters it on the
   * same trace, and the work in progress has to survive that.
   */
  dropSessionForOtherTrace: (traceId: string) => void;

  /**
   * Records a rename. `baselineName` is what the field read before this session
   * touched it, so typing a change and undoing it leaves no draft behind rather
   * than storing a correction that changes nothing.
   */
  setSpanName: (params: { spanId: string; name: string; baselineName: string }) => void;
  setSpanType: (params: {
    spanId: string;
    type: SpanTypes;
    baselineType: string | null;
  }) => void;
  setSpanIO: (params: {
    spanId: string;
    field: "input" | "output";
    text: string;
    baselineText: string | null;
  }) => void;
  /** Removes one field's draft, returning that field to its baseline. */
  resetSpanField: (params: { spanId: string; field: SpanDraftField }) => void;

  setSpanParam: (params: {
    spanId: string;
    key: string;
    /** `null` removes the key from the corrected span. */
    value: unknown;
    baselineParams: Record<string, unknown>;
  }) => void;
  resetSpanParam: (params: { spanId: string; key: string }) => void;

  deleteSpan: (spanId: string) => void;
  restoreSpan: (spanId: string) => void;

  setTraceInput: (params: { text: string; baselineText: string | null }) => void;
  resetTraceInput: () => void;
  setTraceOutput: (params: { text: string; baselineText: string | null }) => void;
  resetTraceOutput: () => void;

  setTraceMetadata: (params: {
    key: string;
    /** `null` removes the key from the corrected trace. */
    value: unknown;
    baselineMetadata: Record<string, unknown>;
  }) => void;
  resetTraceMetadata: (key: string) => void;

  setOverlayView: (view: TraceOverlayView) => void;
}

type TraceEditDraftState = Pick<
  TraceEditState,
  | "basePatch"
  | "spanDrafts"
  | "deletedSpanIds"
  | "restoredSpanIds"
  | "traceInputDraft"
  | "traceOutputDraft"
  | "traceMetadataDrafts"
>;

const EMPTY_DRAFTS = {
  spanDrafts: {} as Record<string, SpanEditDraft>,
  deletedSpanIds: [] as string[],
  restoredSpanIds: [] as string[],
  traceInputDraft: null as SpanIODraft | null,
  traceOutputDraft: null as SpanIODraft | null,
  traceMetadataDrafts: {} as Record<string, unknown>,
};

/** No session, and nothing left over from the last one. */
const CLEARED_SESSION = {
  editingTraceId: null as string | null,
  basePatch: null as TraceEditOverlayPatch | null,
  pendingExit: null as (() => void) | null,
  ...EMPTY_DRAFTS,
};

function withSpanDraft(
  drafts: Record<string, SpanEditDraft>,
  spanId: string,
  update: (draft: SpanEditDraft) => SpanEditDraft,
): Record<string, SpanEditDraft> {
  const next = update(drafts[spanId] ?? {});
  // A draft that ended up empty is removed outright, so "is anything changed"
  // stays a question about presence rather than about contents.
  if (Object.keys(next).length === 0) {
    if (!(spanId in drafts)) return drafts;
    const { [spanId]: _dropped, ...rest } = drafts;
    return rest;
  }
  return { ...drafts, [spanId]: next };
}

/**
 * Moves every draft's attribute snapshot onto the correction that just became
 * the session's baseline. An attribute edited before the stored correction was
 * read froze the captured attributes as the record the overrides apply to, and
 * saving that record would drop whatever attributes the correction already
 * changed.
 */
function rebasedParams(
  drafts: Record<string, SpanEditDraft>,
  basePatch: TraceEditOverlayPatch,
): Record<string, SpanEditDraft> {
  let next: Record<string, SpanEditDraft> | null = null;
  for (const [spanId, draft] of Object.entries(drafts)) {
    if (draft.paramsBase === undefined) continue;
    const params = basePatchForSpan(basePatch, spanId)?.params;
    if (params == null) continue;
    next ??= { ...drafts };
    next[spanId] = { ...draft, paramsBase: params };
  }
  return next ?? drafts;
}

function sameEntries(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && deepEqual(a[key], b[key]));
}

function sameItems(a: unknown[], b: unknown): boolean {
  if (!Array.isArray(b) || a.length !== b.length) return false;
  return a.every((item, i) => deepEqual(item, b[i]));
}

/** Whether two values say the same thing, all the way down. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) return sameItems(a, b);
  if (Array.isArray(b)) return false;
  if (isPlainObject(a) && isPlainObject(b)) return sameEntries(a, b);
  return false;
}

/**
 * Whether writing this value leaves the field saying what it already said.
 *
 * A value the trace recorded as text stays text, so a reviewer who retypes a
 * JSON document into it has changed nothing even though the editor hands back
 * a parsed structure; comparing the parsed baseline is what keeps that from
 * being stored as a correction.
 */
function valuesAgree(baseline: unknown, value: unknown): boolean {
  if (deepEqual(baseline, value)) return true;
  return typeof baseline === "string" && deepEqual(parsedOrUndefined(baseline), value);
}

/** Reads the value a nested attribute path holds, or undefined when it has none. */
function readAtPath(source: Record<string, unknown>, path: string[]): unknown {
  let cursor: unknown = source;
  for (const segment of path) {
    if (!isPlainObject(cursor)) return undefined;
    cursor = cursor[segment];
  }
  return cursor;
}

/**
 * Whether writing this value at this attribute would leave the span exactly as
 * the baseline already has it: the same value, or removing a key the baseline
 * never carried.
 */
function attributeIsUnchanged({
  baselineParams,
  key,
  value,
}: {
  baselineParams: Record<string, unknown>;
  key: string;
  value: unknown;
}): boolean {
  const path = attributePathsByFlatKey(baselineParams).get(key);
  if (!path) return value === null;
  return value !== null && valuesAgree(readAtPath(baselineParams, path), value);
}

/** The same question for one of the trace's own metadata keys, which are flat. */
function metadataIsUnchanged({
  baselineMetadata,
  key,
  value,
}: {
  baselineMetadata: Record<string, unknown>;
  key: string;
  value: unknown;
}): boolean {
  if (!(key in baselineMetadata)) return value === null;
  return value !== null && valuesAgree(baselineMetadata[key], value);
}

/** The value a text field holds, when it holds JSON, and undefined when not. */
function parsedOrUndefined(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Whether the reviewer's text still says what the field said before they
 * touched it. A captured JSON value is seeded into the editor formatted across
 * lines, so the comparison is on what the two texts parse to whenever both are
 * JSON; anything else compares as written.
 */
function ioTextIsUnchanged({
  text,
  baselineText,
}: {
  text: string;
  baselineText: string | null;
}): boolean {
  const baseline = baselineText ?? "";
  if (text === baseline) return true;
  const parsedText = parsedOrUndefined(text);
  const parsedBaseline = parsedOrUndefined(baseline);
  if (parsedText === undefined || parsedBaseline === undefined) return false;
  return JSON.stringify(parsedText) === JSON.stringify(parsedBaseline);
}

/** Drops one field from a draft, leaving the rest of it alone. */
function withoutField(draft: SpanEditDraft, field: SpanDraftField): SpanEditDraft {
  const { [field]: _dropped, ...rest } = draft;
  return rest;
}

/** Drops one attribute override, and the snapshot once none are left. */
function withoutParam(draft: SpanEditDraft, key: string): SpanEditDraft {
  if (!draft.params) return draft;
  const { [key]: _dropped, ...rest } = draft.params;
  if (Object.keys(rest).length === 0) {
    const { params: _params, paramsBase: _base, ...withoutParams } = draft;
    return withoutParams;
  }
  return { ...draft, params: rest };
}

type SetTraceEditState = StoreApi<TraceEditState>["setState"];

/** Starting an editing session, and every way of ending one. */
const sessionActions = (set: SetTraceEditState) => ({
  requestExit: (run: () => void) => set({ pendingExit: run }),
  clearPendingExit: () => set({ pendingExit: null }),
  setDiffOpen: (open: boolean) => set({ diffOpen: open }),

  startEditing: ({
    traceId,
    basePatch,
  }: {
    traceId: string;
    basePatch?: TraceEditOverlayPatch | null;
  }) =>
    // Always from a clean slate: a draft left behind by an earlier trace (or
    // an earlier editing session on this one) would otherwise be attributed to
    // whatever the reviewer opens next.
    set({
      editingTraceId: traceId,
      basePatch: basePatch ?? null,
      ...EMPTY_DRAFTS,
      overlayView: "edited" as const,
    }),

  adoptBasePatch: ({
    traceId,
    basePatch,
  }: {
    traceId: string;
    basePatch: TraceEditOverlayPatch;
  }) =>
    set((s) =>
      s.editingTraceId === traceId && s.basePatch === null
        ? { basePatch, spanDrafts: rebasedParams(s.spanDrafts, basePatch) }
        : s,
    ),

  rebaseBasePatch: ({
    traceId,
    basePatch,
  }: {
    traceId: string;
    basePatch: TraceEditOverlayPatch;
  }) =>
    set((s) =>
      s.editingTraceId === traceId
        ? { basePatch, spanDrafts: rebasedParams(s.spanDrafts, basePatch) }
        : s,
    ),

  // Leaving edit mode and discarding the drafts clear the same session; the two
  // names are kept because the call sites read as different intentions.
  stopEditing: () => set(CLEARED_SESSION),
  discard: () => set(CLEARED_SESSION),

  dropSessionForOtherTrace: (traceId: string) =>
    set((s) =>
      s.editingTraceId !== null && s.editingTraceId !== traceId ? CLEARED_SESSION : {},
    ),
});

/**
 * Editing the name, type, input and output of one span.
 *
 * Every setter drops its field when the reviewer has typed their way back to
 * what the field already said. Without that, changing a value and undoing it
 * leaves a draft that enables Save, stores a correction identical to what was
 * there, and marks the field as edited for good.
 */
const spanFieldActions = (set: SetTraceEditState) => ({
  setSpanName: ({
    spanId,
    name,
    baselineName,
  }: {
    spanId: string;
    name: string;
    baselineName: string;
  }) =>
    set((s) => ({
      spanDrafts: withSpanDraft(s.spanDrafts, spanId, (draft) =>
        name === baselineName ? withoutField(draft, "name") : { ...draft, name },
      ),
    })),

  setSpanType: ({
    spanId,
    type,
    baselineType,
  }: {
    spanId: string;
    type: SpanTypes;
    baselineType: string | null;
  }) =>
    set((s) => ({
      spanDrafts: withSpanDraft(s.spanDrafts, spanId, (draft) =>
        type === baselineType ? withoutField(draft, "type") : { ...draft, type },
      ),
    })),

  setSpanIO: ({
    spanId,
    field,
    text,
    baselineText,
  }: {
    spanId: string;
    field: "input" | "output";
    text: string;
    baselineText: string | null;
  }) =>
    set((s) => ({
      spanDrafts: withSpanDraft(s.spanDrafts, spanId, (draft) =>
        ioTextIsUnchanged({ text, baselineText })
          ? withoutField(draft, field)
          : { ...draft, [field]: { text, baselineText } },
      ),
    })),

  resetSpanField: ({ spanId, field }: { spanId: string; field: SpanDraftField }) =>
    set((s) => ({
      spanDrafts: withSpanDraft(s.spanDrafts, spanId, (draft) =>
        withoutField(draft, field),
      ),
    })),
});

/** Editing the attributes of one span, which are corrected key by key. */
const spanParamActions = (set: SetTraceEditState) => ({
  setSpanParam: ({
    spanId,
    key,
    value,
    baselineParams,
  }: {
    spanId: string;
    key: string;
    value: unknown;
    baselineParams: Record<string, unknown>;
  }) =>
    set((s) => ({
      spanDrafts: withSpanDraft(s.spanDrafts, spanId, (draft) =>
        attributeIsUnchanged({ baselineParams, key, value })
          ? withoutParam(draft, key)
          : {
              ...draft,
              paramsBase: draft.paramsBase ?? baselineParams,
              params: { ...draft.params, [key]: value },
            },
      ),
    })),

  resetSpanParam: ({ spanId, key }: { spanId: string; key: string }) =>
    set((s) => ({
      spanDrafts: withSpanDraft(s.spanDrafts, spanId, (draft) =>
        withoutParam(draft, key),
      ),
    })),
});

/** Removing a span from the trace, and bringing one back. */
const spanRemovalActions = (set: SetTraceEditState) => ({
  deleteSpan: (spanId: string) =>
    set((s) => ({
      deletedSpanIds: s.deletedSpanIds.includes(spanId)
        ? s.deletedSpanIds
        : [...s.deletedSpanIds, spanId],
      restoredSpanIds: s.restoredSpanIds.filter((id) => id !== spanId),
    })),

  restoreSpan: (spanId: string) =>
    set((s) => {
      const wasDeletedByCorrection =
        s.basePatch?.deletedSpanIds.includes(spanId) ?? false;
      return {
        deletedSpanIds: s.deletedSpanIds.filter((id) => id !== spanId),
        restoredSpanIds:
          wasDeletedByCorrection && !s.restoredSpanIds.includes(spanId)
            ? [...s.restoredSpanIds, spanId]
            : s.restoredSpanIds,
      };
    }),
});

export const useTraceEditStore = create<TraceEditState>((set) => ({
  editingTraceId: null,
  basePatch: null,
  ...EMPTY_DRAFTS,
  overlayView: "edited",
  pendingExit: null,
  diffOpen: false,

  ...sessionActions(set),
  ...spanFieldActions(set),
  ...spanParamActions(set),
  ...spanRemovalActions(set),

  setTraceInput: ({ text, baselineText }) =>
    set({
      traceInputDraft: ioTextIsUnchanged({ text, baselineText })
        ? null
        : { text, baselineText },
    }),
  resetTraceInput: () => set({ traceInputDraft: null }),

  setTraceOutput: ({ text, baselineText }) =>
    set({
      traceOutputDraft: ioTextIsUnchanged({ text, baselineText })
        ? null
        : { text, baselineText },
    }),
  resetTraceOutput: () => set({ traceOutputDraft: null }),

  setTraceMetadata: ({ key, value, baselineMetadata }) =>
    set((s) => {
      if (metadataIsUnchanged({ baselineMetadata, key, value })) {
        return { traceMetadataDrafts: withoutKey(s.traceMetadataDrafts, key) };
      }
      return {
        traceMetadataDrafts: { ...s.traceMetadataDrafts, [key]: value },
      };
    }),
  resetTraceMetadata: (key) =>
    set((s) => ({
      traceMetadataDrafts: withoutKey(s.traceMetadataDrafts, key),
    })),

  setOverlayView: (view) => set({ overlayView: view }),
}));

function withoutKey(
  drafts: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  if (!(key in drafts)) return drafts;
  const { [key]: _dropped, ...rest } = drafts;
  return rest;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

function basePatchForSpan(
  basePatch: TraceEditOverlayPatch | null,
  spanId: string,
): TraceEditSpanPatch | undefined {
  return basePatch?.spans.find((span) => span.spanId === spanId);
}

/**
 * What a field should read before this session touched it: the stored
 * correction's value if it has one, and nothing otherwise (the caller falls
 * back to the captured span). This is what an editor is seeded from and what
 * Reset returns to, so correcting a trace twice starts from the first
 * correction rather than from the raw capture.
 */
export function selectSpanEditBaseline({
  basePatch,
  spanId,
}: {
  basePatch: TraceEditOverlayPatch | null;
  spanId: string;
}): EffectiveSpanEdit {
  const base = basePatchForSpan(basePatch, spanId);
  if (!base) return {};

  const baseline: EffectiveSpanEdit = {};
  if (base.name != null) baseline.name = base.name;
  if (base.type !== undefined) baseline.type = base.type;
  if (base.input !== undefined) baseline.input = stringifySpanIO(base.input) ?? "";
  if (base.output !== undefined) {
    baseline.output = stringifySpanIO(base.output) ?? "";
  }
  if (base.params != null) baseline.params = base.params;
  return baseline;
}

/** The trace-level input the stored correction already carries, if any. */
export function selectTraceInputBaseline(
  basePatch: TraceEditOverlayPatch | null,
): string | undefined {
  return basePatch?.trace?.input?.value;
}

/** The trace-level output the stored correction already carries, if any. */
export function selectTraceOutputBaseline(
  basePatch: TraceEditOverlayPatch | null,
): string | undefined {
  return basePatch?.trace?.output?.value;
}

/**
 * The trace metadata an editor starts from: the captured keys with whatever a
 * stored correction already changed about them laid over.
 */
export function selectTraceMetadataBaseline({
  basePatch,
  captured,
}: {
  basePatch: TraceEditOverlayPatch | null;
  captured: Record<string, unknown>;
}): Record<string, unknown> {
  const stored = basePatch?.trace?.metadata;
  if (stored === undefined) return captured;
  if (stored === null) return {};

  const baseline: Record<string, unknown> = { ...captured };
  for (const [key, value] of Object.entries(stored)) {
    if (value === null) delete baseline[key];
    else baseline[key] = value;
  }
  return baseline;
}

/** True when this span is removed by the correction as it currently stands. */
export function selectIsSpanDeleted(
  state: Pick<TraceEditState, "basePatch" | "deletedSpanIds" | "restoredSpanIds">,
  spanId: string,
): boolean {
  if (state.deletedSpanIds.includes(spanId)) return true;
  if (state.restoredSpanIds.includes(spanId)) return false;
  return state.basePatch?.deletedSpanIds.includes(spanId) ?? false;
}

/** The attributes an editor starts from: corrected if they already are. */
export function selectSpanParamsBaseline({
  basePatch,
  spanId,
  captured,
}: {
  basePatch: TraceEditOverlayPatch | null;
  spanId: string;
  captured: Record<string, unknown>;
}): Record<string, unknown> {
  return selectSpanEditBaseline({ basePatch, spanId }).params ?? captured;
}

/** Everything the correction would change, as counted for the edit bar. */
export interface TraceEditSummary {
  changedFields: number;
  deletedSpans: number;
}

const IO_FIELDS = ["input", "output"] as const;

function draftFieldCount(draft: SpanEditDraft): number {
  let count = 0;
  if (draft.name !== undefined) count++;
  if (draft.type !== undefined) count++;
  for (const field of IO_FIELDS) if (draft[field] !== undefined) count++;
  if (draft.params !== undefined) count++;
  return count;
}

/**
 * Counts what this editing session changes. The stored correction is not part
 * of the count: the reviewer is being told what they are about to add, not
 * what somebody already saved.
 */
export function summarizeTraceEdit(state: TraceEditDraftState): TraceEditSummary {
  const deleted = new Set(state.deletedSpanIds);
  let changedFields = 0;
  if (state.traceInputDraft) changedFields++;
  if (state.traceOutputDraft) changedFields++;
  // The metadata counts once however many keys were corrected, the way a span's
  // attributes count once: the reviewer changed "the metadata".
  if (Object.keys(state.traceMetadataDrafts).length > 0) changedFields++;
  for (const [spanId, draft] of Object.entries(state.spanDrafts)) {
    if (deleted.has(spanId)) continue;
    changedFields += draftFieldCount(draft);
  }
  changedFields += state.restoredSpanIds.length;
  return { changedFields, deletedSpans: state.deletedSpanIds.length };
}

/** True when the session would change something. Drives the Save button. */
export function selectIsTraceEditDirty(state: TraceEditDraftState): boolean {
  const summary = summarizeTraceEdit(state);
  return summary.changedFields > 0 || summary.deletedSpans > 0;
}

// ---------------------------------------------------------------------------
// Building the correction
// ---------------------------------------------------------------------------

/**
 * A hint about what the baseline value was, for the shared encoder. Text that
 * never parsed as JSON was prose, so it is declared as text and stays text
 * however the reviewer rewrites it; anything else lets the encoder decide from
 * the new text.
 */
function baselineShapeHint(baselineText: string | null): SpanInputOutput | null {
  if (baselineText === null) return null;
  const trimmed = baselineText.trim();
  if (trimmed.length === 0) return null;
  try {
    JSON.parse(trimmed);
    return null;
  } catch {
    return { type: "text", value: baselineText };
  }
}

function encodeDraftIO(draft: SpanIODraft): SpanInputOutput {
  return encodeSpanIOFromEditedText({
    text: draft.text,
    original: baselineShapeHint(draft.baselineText),
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Where each attribute the reviewer sees lives inside the nested params object.
 * The attributes table shows one flat dotted key per leaf, so an edit to
 * `langwatch.params.region` has to land on `params.langwatch.params.region`
 * rather than on a new top-level key that only looks the same. Building the map
 * by walking the params exactly as the table flattens them keeps the two in
 * step even for a segment that itself contains a dot.
 */
function attributePathsByFlatKey(
  params: Record<string, unknown>,
  prefix: string[] = [],
  out = new Map<string, string[]>(),
): Map<string, string[]> {
  for (const [key, value] of Object.entries(params)) {
    const path = [...prefix, key];
    if (isPlainObject(value)) attributePathsByFlatKey(value, path, out);
    else out.set(path.join("."), path);
  }
  return out;
}

/**
 * Writes a value at a nested path, copying every object along the way so the
 * baseline the draft started from is never mutated.
 */
function setAtPath(
  target: Record<string, unknown>,
  path: string[],
  value: unknown,
): void {
  let cursor = target;
  for (const segment of path.slice(0, -1)) {
    const next = cursor[segment];
    const copy = isPlainObject(next) ? { ...next } : {};
    cursor[segment] = copy;
    cursor = copy;
  }
  cursor[path[path.length - 1]!] = value;
}

/**
 * Removes the leaf at a nested path and any ancestor left empty by the removal,
 * so a removed attribute leaves no trace behind in the exported span.
 */
function deleteAtPath(target: Record<string, unknown>, path: string[]): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    delete target[head];
    return;
  }
  const child = target[head];
  if (!isPlainObject(child)) return;
  const copy = { ...child };
  deleteAtPath(copy, rest);
  if (Object.keys(copy).length === 0) delete target[head];
  else target[head] = copy;
}

function mergedParams(draft: SpanEditDraft): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...draft.paramsBase };
  const paths = attributePathsByFlatKey(merged);
  for (const [key, value] of Object.entries(draft.params ?? {})) {
    const path = paths.get(key) ?? [key];
    if (value === null) deleteAtPath(merged, path);
    else setAtPath(merged, path, value);
  }
  return merged;
}

function mergeSpanPatch({
  base,
  draft,
  spanId,
}: {
  base: TraceEditSpanPatch | undefined;
  draft: SpanEditDraft | undefined;
  spanId: string;
}): TraceEditSpanPatch | null {
  const merged: TraceEditSpanPatch = { ...(base ?? { spanId }), spanId };
  if (draft?.name !== undefined) merged.name = draft.name;
  if (draft?.type !== undefined) merged.type = draft.type;
  if (draft?.input !== undefined) merged.input = encodeDraftIO(draft.input);
  if (draft?.output !== undefined) merged.output = encodeDraftIO(draft.output);
  if (draft?.params !== undefined) {
    // A correction replaces the whole attribute record, so it is only written
    // when the record actually says something different. Without this, one
    // attribute touched and put back would store every attribute the span
    // carries as a correction, and every row of it would read as edited.
    const params = mergedParams(draft);
    if (!deepEqual(params, draft.paramsBase ?? {})) merged.params = params;
  }

  const touchesSomething = Object.keys(merged).some((key) => key !== "spanId");
  return touchesSomething ? merged : null;
}

/**
 * Turns the stored correction plus this session's draft into the correction to
 * save. Text becomes a canonical captured value through the same encoder the
 * server uses, so the drawer and the suggestion flow agree on what a given
 * piece of text means.
 */
export function buildTraceEditPatch(state: TraceEditDraftState): TraceEditOverlayPatch {
  const deletedSpanIds = mergeDeletedSpanIds(state);
  const trace = mergeTracePatch(state);

  return {
    version: TRACE_EDIT_OVERLAY_PATCH_VERSION,
    ...(trace ? { trace } : {}),
    spans: mergeSpanPatches({ state, deletedSpanIds }),
    deletedSpanIds,
  };
}

/**
 * The spans the correction removes: what it already removed, minus anything
 * the reviewer brought back, plus what they removed in this session.
 */
function mergeDeletedSpanIds(state: TraceEditDraftState): string[] {
  const storedDeleted = state.basePatch?.deletedSpanIds ?? [];
  const restored = new Set(state.restoredSpanIds);
  return [
    ...storedDeleted.filter((id) => !restored.has(id)),
    ...state.deletedSpanIds.filter((id) => !storedDeleted.includes(id)),
  ];
}

/** The per-span corrections, layered on whatever was already stored. */
function mergeSpanPatches({
  state,
  deletedSpanIds,
}: {
  state: TraceEditDraftState;
  deletedSpanIds: string[];
}): TraceEditSpanPatch[] {
  const base = state.basePatch;
  const deleted = new Set(deletedSpanIds);
  const spanIds = new Set([
    ...(base?.spans ?? []).map((span) => span.spanId),
    ...Object.keys(state.spanDrafts),
  ]);

  const spans: TraceEditSpanPatch[] = [];
  for (const spanId of spanIds) {
    // A span that is being removed carries no field corrections: the span is
    // going away, so an edit to it would only make the stored patch disagree
    // with what the reader sees.
    if (deleted.has(spanId)) continue;
    const merged = mergeSpanPatch({
      base: basePatchForSpan(base, spanId),
      draft: state.spanDrafts[spanId],
      spanId,
    });
    if (merged) spans.push(merged);
  }
  return spans;
}

/**
 * The trace's own corrected metadata, layered on whatever the stored correction
 * already changed. A stored clear is replaced once new keys are corrected: the
 * overlay says which keys change, and "clear everything except these" is not a
 * thing it can say.
 */
function mergeTraceMetadata(state: TraceEditDraftState): TraceMetadataEdits {
  const base = state.basePatch?.trace?.metadata;
  if (Object.keys(state.traceMetadataDrafts).length === 0) return base;
  return { ...(base ?? {}), ...state.traceMetadataDrafts };
}

/** The trace's own corrected input, output and metadata, when any has one. */
function mergeTracePatch(state: TraceEditDraftState): TraceEditOverlayPatch["trace"] {
  const base = state.basePatch?.trace;
  const input = state.traceInputDraft
    ? { value: state.traceInputDraft.text }
    : base?.input;
  const output = state.traceOutputDraft
    ? { value: state.traceOutputDraft.text }
    : base?.output;
  const metadata = mergeTraceMetadata(state);
  if (input === undefined && output === undefined && metadata === undefined) {
    return undefined;
  }

  return {
    ...(input !== undefined ? { input } : {}),
    ...(output !== undefined ? { output } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  };
}
