import { readUiStorage, writeUiStorage } from "@langwatch/ui-host/storage";
import { useMemo } from "react";
import { create, type StateCreator } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { getCurrentFilterText, useFilterStore } from "./filter.store.ts";
import {
  LENS_CAPABILITIES,
  reconcileAddons,
  reconcileColumns,
  reconcileSort,
} from "./lens-capabilities.ts";
import type { RowKind } from "../model/trace-row-kind.ts";
import { nowInstant } from "@langwatch/time";

export type GroupingMode = "flat" | "by-conversation" | "by-service" | "by-user" | "by-model";

export interface SortConfig {
  columnId: string;
  direction: "asc" | "desc";
}

export interface LensConfig {
  id: string;
  name: string;
  isBuiltIn: boolean;
  columns: string[];
  /** Composable extra-row decorators (registry addon ids) rendered below the main row. */
  addons: string[];
  grouping: GroupingMode;
  sort: SortConfig;
  /** Saved filter expression (Liqe query text). */
  filterText: string;
}

export function getEffectiveLens(state: {
  allLenses: LensConfig[];
  activeLensId: string;
  sort: SortConfig;
  grouping: GroupingMode;
  columnOrder: string[];
}): LensConfig | null {
  const lens = state.allLenses.find((l) => l.id === state.activeLensId) ?? state.allLenses[0];
  if (!lens) return null;
  // Reconcile addons against the LIVE grouping's capability — not the saved lens's.
  const capability = LENS_CAPABILITIES[state.grouping];
  return {
    ...lens,
    sort: state.sort,
    grouping: state.grouping,
    columns: state.columnOrder.length > 0 ? state.columnOrder : lens.columns,
    addons: reconcileAddons(lens.addons, capability),
  };
}

/**
 * The effective lens as a stable subscription: the slices are compared
 * shallowly and the derived object is memoised, so the store snapshot
 * settles instead of re-rendering the table forever.
 */
export function useEffectiveLens(): LensConfig | null {
  const slices = useViewStore(
    useShallow((state) => ({
      allLenses: state.allLenses,
      activeLensId: state.activeLensId,
      sort: state.sort,
      grouping: state.grouping,
      columnOrder: state.columnOrder,
    })),
  );
  return useMemo(() => getEffectiveLens(slices), [slices]);
}

export function rowKindForGrouping(grouping: GroupingMode): RowKind {
  if (grouping === "by-conversation") return "conversation";
  if (grouping === "flat") return "trace";
  return "group";
}

export function groupByForGrouping(grouping: GroupingMode): "service" | "model" | "user" | null {
  if (grouping === "by-service") return "service";
  if (grouping === "by-model") return "model";
  if (grouping === "by-user") return "user";
  return null;
}

interface DraftLensState {
  sort?: SortConfig;
  grouping?: GroupingMode;
  columns?: string[];
  filter?: string;
}

/**
 * Fields the rich create dialog can supply when materialising a brand-new lens instead
 * of snapshotting the active table state.
 */
export interface LensDraftInput {
  columns: string[];
  addons: string[];
  grouping: GroupingMode;
  sort: SortConfig;
  filterText: string;
}

interface ViewState {
  activeLensId: string;
  allLenses: LensConfig[];
  sort: SortConfig;
  grouping: GroupingMode;
  columnOrder: string[];
  draftState: Map<string, DraftLensState>;

  selectLens: (id: string, opts?: { persist?: boolean }) => void;
  setSort: (sort: SortConfig) => void;
  setGrouping: (mode: GroupingMode) => void;
  toggleColumn: (columnId: string) => void;
  reorderColumns: (fromIndex: number, toIndex: number) => void;
  setVisibleColumns: (columns: string[]) => void;
  setFilterDraft: (text: string) => void;

  isDraft: (lensId: string) => boolean;
  createLens: (name: string, overrides?: Partial<LensDraftInput>) => string;
  revertLens: (lensId: string) => void;
  renameLens: (lensId: string, name: string) => void;
  duplicateLens: (lensId: string) => string;
  deleteLens: (lensId: string) => void;
  /**
   * Replace all non-built-in lenses with the supplied list, sourced from the server
   * (kind=v2-traces-lens). Built-in lenses are preserved in place, dismissed built-ins
   * stay dismissed.
   */
  setUserLenses: (lenses: LensConfig[]) => void;
}

/**
 * Optional bridge for mirroring lens mutations to the server. When set (typically by
 * `useLensSync`), the store calls these alongside its local writes so localStorage
 * stays a hot cache and the server stays the source of truth.
 */
export interface LensSyncBridge {
  create: (lens: LensConfig & { /** Optional client-suggested id. */ id: string }) => void;
  rename: (lensId: string, name: string) => void;
  delete: (lensId: string) => void;
}

let lensSyncBridge: LensSyncBridge | null = null;

export function setLensSyncBridge(bridge: LensSyncBridge | null): void {
  lensSyncBridge = bridge;
}

const DISMISSED_BUILTINS_KEY = "langwatch:traces-v2:dismissed-builtins:v1";
const DRAFTS_KEY = "langwatch:traces-v2:drafts:v1";
// Last-used lens id. Deliberately NOT project-scoped: built-in lens ids (all-traces /
// simplified / conversations / …) are identical across every project, so a single
// global key restores the user's preferred view cross-project.
export const ACTIVE_LENS_KEY = "langwatch:traces-v2:active-lens:v1";

/**
 * The last-used lens id from the global cross-project key, or `null` when it
 * is unset, on the server, or when storage is unavailable.
 */
export function getPersistedActiveLensId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return readUiStorage(ACTIVE_LENS_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Records the last-used lens id in the global cross-project key. A no-op on the
 * server or when storage is full/disabled, so callers never need to guard.
 */
function persistActiveLensId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    writeUiStorage(ACTIVE_LENS_KEY, id);
  } catch {
    // storage may be full / disabled
  }
}

/** Newest first: the order the flat trace list falls back to. */
export const DEFAULT_SORT: SortConfig = { columnId: "time", direction: "desc" };

function isGroupingMode(value: unknown): value is GroupingMode {
  return (
    value === "flat" ||
    value === "by-conversation" ||
    value === "by-service" ||
    value === "by-user" ||
    value === "by-model"
  );
}

function migrateGrouping(value: unknown): GroupingMode | undefined {
  if (value === "by-session") return "by-conversation";
  return isGroupingMode(value) ? value : undefined;
}

// Custom lenses no longer round-trip through localStorage. They live on the server
// (SavedView table, kind="v2-traces-lens") and `useLensSync` pushes them into the store
// via `setUserLenses` whenever the tRPC query resolves.

function isSortConfig(value: unknown): value is SortConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.columnId === "string" && (v.direction === "asc" || v.direction === "desc");
}

/** One stored draft, keeping only the fields that survived the shape check. */
function readDraft(value: unknown): DraftLensState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const draft: DraftLensState = {};
  if (isSortConfig(v.sort)) draft.sort = v.sort;
  const grouping = migrateGrouping(v.grouping);
  if (grouping) draft.grouping = grouping;
  if (Array.isArray(v.columns)) {
    draft.columns = v.columns.filter((c): c is string => typeof c === "string");
  }
  if (typeof v.filter === "string") draft.filter = v.filter;
  return Object.keys(draft).length > 0 ? draft : null;
}

function loadDrafts(): Map<string, DraftLensState> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = readUiStorage(DRAFTS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return new Map();
    const out = new Map<string, DraftLensState>();
    for (const [lensId, value] of Object.entries(parsed)) {
      const draft = readDraft(value);
      if (draft) out.set(lensId, draft);
    }
    return out;
  } catch {
    return new Map();
  }
}

function persistDrafts(drafts: Map<string, DraftLensState>): void {
  if (typeof window === "undefined") return;
  try {
    const obj: Record<string, DraftLensState> = {};
    for (const [k, v] of drafts) obj[k] = v;
    writeUiStorage(DRAFTS_KEY, JSON.stringify(obj));
  } catch {
    // storage may be full / disabled
  }
}

function loadDismissedBuiltInIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = readUiStorage(DISMISSED_BUILTINS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function persistDismissedBuiltInIds(ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    writeUiStorage(DISMISSED_BUILTINS_KEY, JSON.stringify([...ids]));
  } catch {
    // storage may be full / disabled
  }
}

const builtInLenses: LensConfig[] = [
  {
    id: "all-traces",
    name: "All",
    isBuiltIn: true,
    columns: [
      "time",
      "trace",
      "origin",
      "duration",
      "cost",
      "tokens",
      "spans",
      "model",
      "labels",
      "evaluations",
      "prompt",
      "events",
    ],
    addons: ["io-preview", "expanded-peek"],
    grouping: "flat",
    sort: DEFAULT_SORT,
    filterText: "",
  },
  {
    // Low-density alternative to the All lens: input / output split into their own
    // columns instead of smashed into the composite `trace (summary)` cell + the
    // `io-preview` second-row addon.
    id: "simplified",
    name: "Simplified",
    isBuiltIn: true,
    columns: ["time", "trace-name", "input", "output", "duration"],
    addons: [],
    grouping: "flat",
    sort: DEFAULT_SORT,
    filterText: "",
  },
  {
    // Rows come from the server-side session rollup with true totals per
    // conversation, plus context size and last activity
    // (specs/traces-v2/sessions-lens.feature).
    id: "conversations",
    name: "Conversations",
    isBuiltIn: true,
    columns: [
      "conversation",
      "turns",
      "lastTurn",
      "duration",
      "cost",
      "tokens",
      "contextSize",
      "model",
      "service",
      "status",
    ],
    addons: ["conversation-turns"],
    grouping: "by-conversation",
    sort: DEFAULT_SORT,
    filterText: "",
  },
  {
    id: "errors",
    name: "Errors",
    isBuiltIn: true,
    columns: ["time", "trace", "service", "duration", "cost", "model", "evaluations", "events"],
    addons: ["error-detail", "expanded-peek"],
    grouping: "flat",
    sort: DEFAULT_SORT,
    filterText: "status:error",
  },
  {
    // Id kept as "slow-requests" so existing dismissals / selected-lens
    // persistence keyed by it survive the rename. Lives under the
    // "Performance" dropdown (see PERFORMANCE_LENS_IDS).
    id: "slow-requests",
    name: "Slow Traces",
    isBuiltIn: true,
    columns: ["time", "trace", "service", "model", "duration", "tokens", "cost"],
    addons: ["error-detail", "io-preview"],
    grouping: "flat",
    sort: { columnId: "duration", direction: "desc" },
    filterText: "",
  },
  {
    // Heaviest token traces. Performance dropdown.
    id: "token-heavy-traces",
    name: "Token-Heavy Traces",
    isBuiltIn: true,
    columns: ["time", "trace", "service", "model", "tokens", "cost", "duration"],
    addons: ["error-detail", "io-preview"],
    grouping: "flat",
    sort: { columnId: "tokens", direction: "desc" },
    filterText: "",
  },
  {
    // Heaviest token conversations: tokens roll up per conversation,
    // server-side.
    id: "token-heavy-conversations",
    name: "Token-Heavy Conversations",
    isBuiltIn: true,
    columns: ["conversation", "turns", "tokens", "cost", "duration", "model", "service"],
    addons: ["conversation-turns"],
    grouping: "by-conversation",
    sort: { columnId: "tokens", direction: "desc" },
    filterText: "",
  },
  {
    // Conversations with the most traces. Sorts by the per-conversation trace
    // count, a rollup dimension the sessions read orders by server-side.
    id: "longest-conversations",
    name: "Longest Conversations",
    isBuiltIn: true,
    columns: ["conversation", "turns", "duration", "tokens", "cost", "model", "service"],
    addons: ["conversation-turns"],
    grouping: "by-conversation",
    sort: { columnId: "turns", direction: "desc" },
    filterText: "",
  },
  {
    // Costliest individual traces. Cost dropdown (see COST_LENS_IDS).
    id: "expensive-traces",
    name: "Expensive Traces",
    isBuiltIn: true,
    columns: ["time", "trace", "service", "model", "cost", "tokens", "duration"],
    addons: ["error-detail", "io-preview"],
    grouping: "flat",
    sort: { columnId: "cost", direction: "desc" },
    filterText: "",
  },
  {
    // Costliest conversations: cost rolls up per conversation, server-side.
    id: "expensive-conversations",
    name: "Expensive Conversations",
    isBuiltIn: true,
    columns: ["conversation", "turns", "cost", "tokens", "duration", "model", "service"],
    addons: ["conversation-turns"],
    grouping: "by-conversation",
    sort: { columnId: "cost", direction: "desc" },
    filterText: "",
  },
  {
    // Largest individual traces by stored payload size. Cost dropdown (see
    // COST_LENS_IDS); sorts by the `_size_bytes`-backed "size" column.
    id: "large-traces",
    name: "Large Traces",
    isBuiltIn: true,
    columns: ["time", "trace", "service", "model", "size", "tokens", "duration"],
    addons: ["error-detail", "io-preview"],
    grouping: "flat",
    sort: { columnId: "size", direction: "desc" },
    filterText: "",
  },
  // The built-in lens shelf used to ship Quality review, By Field, and By
  // Model alongside the above. Removed in the bug-bash so the tab strip
  // stays scannable — users who want them can create a custom lens with
  // the same shape via the New lens flow.
];

/**
 * Built-in lenses folded under named dimension dropdowns in the lens bar so
 * they share a slot instead of crowding the flat strip. Order is the
 * dropdown order. See specs/traces-v2/lens-preset-groups.feature
 */
export const COST_LENS_IDS = [
  "expensive-traces",
  "large-traces",
  "expensive-conversations",
] as const;

export const PERFORMANCE_LENS_IDS = [
  "slow-requests",
  "token-heavy-traces",
  "token-heavy-conversations",
  "longest-conversations",
] as const;

const defaultColumnOrder: string[] = [
  "time",
  "trace",
  "service",
  "duration",
  "cost",
  "tokens",
  "spans",
  "model",
  "labels",
];

function generateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `custom-${crypto.randomUUID()}`;
  }
  return `custom-${nowInstant().epochMilliseconds}-${Math.random().toString(36).slice(2, 10)}`;
}

function setDraft(
  drafts: Map<string, DraftLensState>,
  lensId: string,
  patch: DraftLensState,
): Map<string, DraftLensState> {
  const next = new Map(drafts);
  const current = next.get(lensId) ?? {};
  next.set(lensId, { ...current, ...patch });
  persistDrafts(next);
  return next;
}

function clearDraftFor(
  drafts: Map<string, DraftLensState>,
  lensId: string,
): Map<string, DraftLensState> {
  if (!drafts.has(lensId)) return drafts;
  const next = new Map(drafts);
  next.delete(lensId);
  persistDrafts(next);
  return next;
}

/**
 * Push a lens's saved filter into the filter store. Imperative one-way write —
 * viewStore never subscribes to filterStore.
 */
function applyFilterTextFromLens(text: string): void {
  useFilterStore.getState().setFilterFromLens(text);
}

/**
 * Drop the trace list's keyset cursors whenever the sort that minted them changes.
 */
function dropKeysetCursorsIfSortChanged({
  previous,
  next,
}: {
  previous: SortConfig;
  next: SortConfig;
}): void {
  if (previous.columnId === next.columnId && previous.direction === next.direction) {
    return;
  }
  useFilterStore.getState().resetPagination();
}

const initialDismissedBuiltIns = loadDismissedBuiltInIds();
const initialLenses: LensConfig[] = builtInLenses.filter(
  (l) => !initialDismissedBuiltIns.has(l.id),
);
const persistedActiveLensId = getPersistedActiveLensId();
const initialActiveLensId =
  // Restore the persisted lens when it's already known (a built-in, present
  // at init). Custom lenses hydrate later and are restored in setUserLenses.
  (persistedActiveLensId && initialLenses.find((l) => l.id === persistedActiveLensId)?.id) ||
  initialLenses.find((l) => l.id === "all-traces")?.id ||
  initialLenses[0]?.id ||
  "all-traces";
const initialDrafts = loadDrafts();
const initialActiveLens = initialLenses.find((l) => l.id === initialActiveLensId);
const initialActiveDraft = initialDrafts.get(initialActiveLensId);

export const useViewStore = create<ViewState>((set, get) => ({
  activeLensId: initialActiveLensId,
  allLenses: initialLenses,
  sort: initialActiveDraft?.sort ?? initialActiveLens?.sort ?? DEFAULT_SORT,
  grouping: initialActiveDraft?.grouping ?? initialActiveLens?.grouping ?? "flat",
  columnOrder: initialActiveDraft?.columns ?? initialActiveLens?.columns ?? defaultColumnOrder,
  draftState: initialDrafts,

  ...viewShapeActions(set, get),
  ...lensLibraryActions(set, get),
  ...lensLifecycleActions(set, get),
}));

type ViewSet = Parameters<StateCreator<ViewState>>[0];
type ViewGet = Parameters<StateCreator<ViewState>>[1];

/** How the current view is shaped: which lens, its sort, grouping, columns and filter. */
function viewShapeActions(
  set: ViewSet,
  get: ViewGet,
): Pick<
  ViewState,
  | "selectLens"
  | "setSort"
  | "setGrouping"
  | "toggleColumn"
  | "reorderColumns"
  | "setVisibleColumns"
  | "setFilterDraft"
> {
  return {
    selectLens: (id, opts) => {
      set((s) => selectedLensState(s, id, opts?.persist !== false));
    },

    // Every per-view tweak goes through `draftState` regardless of whether the active
    // lens is built-in or custom. The "unsaved" dot on the lens tab keys off
    // `isDraft(lensId)`, so showing it for built-ins requires tracking those drafts too.
    setSort: (sort) => {
      dropKeysetCursorsIfSortChanged({ previous: get().sort, next: sort });
      set((s) => ({
        sort,
        draftState: setDraft(s.draftState, s.activeLensId, { sort }),
      }));
    },

    setGrouping: (mode) => {
      // Each grouping mode renders a different RowKind with its own column registry —
      // e.g. flat knows `time/trace/service`, group knows `group/count/duration`.
      const s = get();
      const capability = LENS_CAPABILITIES[mode];
      const columns = reconcileColumns({ ids: s.columnOrder, capability });
      const sort = reconcileSort(s.sort, capability);
      // reconcileSort can swap the sort column out from under the table without
      // the user ever touching a header: a grouped RowKind can't order by
      // `time` (nor `spans`/`ttft`/`size`), so those all land on `count`. That
      // is a sort change like any other, and the cursors have to go with it.
      dropKeysetCursorsIfSortChanged({ previous: s.sort, next: sort });
      set({
        grouping: mode,
        columnOrder: columns,
        sort,
        draftState: setDraft(s.draftState, s.activeLensId, {
          grouping: mode,
          columns,
          sort,
        }),
      });
    },

    toggleColumn: (columnId) => set((s) => withColumnOrder(s, toggledColumnOrder(s, columnId))),

    reorderColumns: (fromIndex, toIndex) =>
      set((s) => {
        const order = reorderedColumns(s.columnOrder, fromIndex, toIndex);
        return order ? withColumnOrder(s, order) : s;
      }),

    setVisibleColumns: (columns) =>
      set((s) => ({
        columnOrder: columns,
        draftState: setDraft(s.draftState, s.activeLensId, { columns }),
      })),

    setFilterDraft: (text) => set((s) => filterDraftState(s, text)),
  };
}

/** The lens library itself: drafts, creation, renaming, duplication and deletion. */
function lensLibraryActions(
  set: ViewSet,
  get: ViewGet,
): Pick<ViewState, "isDraft" | "createLens" | "revertLens" | "renameLens"> {
  return {
    isDraft: (lensId) => get().draftState.has(lensId),

    // Snapshot the current view (columns, grouping, sort, filter text) into a new
    // persisted lens. Both "Create lens" (from scratch) and "Save as new lens" (fork from
    // current) flows go through here — the only difference is the supplied name.
    createLens: (name, overrides) => {
      const state = get();
      const newLens = lensFromSnapshot({ name, overrides, state });
      const allLenses = [...state.allLenses, newLens];
      lensSyncBridge?.create(newLens);
      // The new lens becomes the active one. With overrides present the saved
      // values also go into live state, so the table reflects the configured
      // shape at once rather than keeping the old grouping and columns until the
      // reader switches tabs.
      if (!overrides) {
        set({ allLenses, activeLensId: newLens.id });
        return newLens.id;
      }
      applyFilterTextFromLens(newLens.filterText);
      set({ allLenses, ...adoptedLensState(newLens) });
      return newLens.id;
    },

    revertLens: (lensId) => {
      const s = get();
      const lens = s.allLenses.find((l) => l.id === lensId);
      if (!lens) return;
      const draftState = clearDraftFor(s.draftState, lensId);
      if (s.activeLensId !== lensId) {
        set({ draftState });
        return;
      }
      applyFilterTextFromLens(lens.filterText);
      set({ draftState, sort: lens.sort, grouping: lens.grouping, columnOrder: lens.columns });
    },

    renameLens: (lensId, name) =>
      set((s) => {
        const lens = s.allLenses.find((l) => l.id === lensId);
        if (!lens || lens.isBuiltIn) return s;
        const allLenses = s.allLenses.map((l) => (l.id === lensId ? { ...l, name } : l));
        lensSyncBridge?.rename(lensId, name);
        return { allLenses };
      }),
  };
}

/** Copying, deleting and re-hydrating the lenses the reader owns. */
function lensLifecycleActions(
  set: ViewSet,
  get: ViewGet,
): Pick<ViewState, "duplicateLens" | "deleteLens" | "setUserLenses"> {
  return {
    duplicateLens: (lensId) => {
      const state = get();
      const lens = state.allLenses.find((l) => l.id === lensId);
      if (!lens) return lensId;
      // The SAVED lens is duplicated, never the live draft — the "Save as new
      // lens" action is what captures a draft.
      const newLens: LensConfig = {
        ...lens,
        id: generateId(),
        name: `${lens.name} (copy)`,
        isBuiltIn: false,
      };
      lensSyncBridge?.create(newLens);
      applyFilterTextFromLens(newLens.filterText);
      set({ allLenses: [...state.allLenses, newLens], ...adoptedLensState(newLens) });
      return newLens.id;
    },

    deleteLens: (lensId) => {
      const s = get();
      const lens = s.allLenses.find((l) => l.id === lensId);
      if (!lens || !isDeletableLens(s, lensId)) return;
      forgetLens(lens, lensId);
      const allLenses = s.allLenses.filter((l) => l.id !== lensId);
      const draftState = clearDraftFor(s.draftState, lensId);
      if (s.activeLensId !== lensId) {
        set({ allLenses, draftState });
        return;
      }
      const firstLens = allLenses[0];
      if (!firstLens) return;
      applyFilterTextFromLens(firstLens.filterText);
      set({ allLenses, draftState, ...adoptedLensState(firstLens) });
    },

    setUserLenses: (lenses) => {
      set((s) => mergedUserLenses(s, lenses));
    },
  };
}

/** The view a lens (and any draft over it) puts on screen. */
function selectedLensState(s: ViewState, id: string, persist: boolean): Partial<ViewState> {
  const lens = s.allLenses.find((l) => l.id === id);
  if (!lens) return s;
  // Remember the choice as the last-used lens, across navigation and across
  // projects for built-ins. `useURLSync` passes persist:false when it is only
  // applying a lens — falling back to the default because a bare URL carries
  // none — so that path never clobbers the stored preference.
  if (persist) persistActiveLensId(id);
  const draft = s.draftState.get(id);
  // The lens's filter, or its draft override, goes to filterStore through the
  // silent setter: `applyQueryText` would loop back through `setFilterDraft`
  // and mark the lens dirty on the spot.
  applyFilterTextFromLens(draft?.filter ?? lens.filterText);
  return {
    activeLensId: id,
    sort: draft?.sort ?? lens.sort,
    grouping: draft?.grouping ?? lens.grouping,
    columnOrder: draft?.columns ?? lens.columns,
  };
}

/** A new column order, recorded as a draft against the active lens. */
function withColumnOrder(s: ViewState, order: string[]): Partial<ViewState> {
  return {
    columnOrder: order,
    draftState: setDraft(s.draftState, s.activeLensId, { columns: order }),
  };
}

/** The column order with one column added or removed. */
function toggledColumnOrder(s: ViewState, columnId: string): string[] {
  if (s.columnOrder.includes(columnId)) return s.columnOrder.filter((id) => id !== columnId);
  return [...s.columnOrder, columnId];
}

/** The column order with one column moved, or null when the move is a no-op. */
function reorderedColumns(
  columnOrder: string[],
  fromIndex: number,
  toIndex: number,
): string[] | null {
  if (fromIndex === toIndex) return null;
  if (fromIndex < 0 || toIndex < 0) return null;
  if (fromIndex >= columnOrder.length || toIndex >= columnOrder.length) return null;
  const order = [...columnOrder];
  const [moved] = order.splice(fromIndex, 1);
  if (!moved) return null;
  order.splice(toIndex, 0, moved);
  return order;
}

/** The draft's other fields, with the filter dropped. */
function draftWithoutFilter(existing: DraftLensState): DraftLensState {
  const rest: DraftLensState = {};
  if (existing.sort !== undefined) rest.sort = existing.sort;
  if (existing.grouping !== undefined) rest.grouping = existing.grouping;
  if (existing.columns !== undefined) rest.columns = existing.columns;
  return rest;
}

/**
 * A filter matching the lens's saved value drops the draft entry rather than
 * carrying a no-op marker around. Any other draft fields on the lens survive:
 * the entry only goes when what is left of it would be empty.
 */
function filterDraftState(s: ViewState, text: string): Partial<ViewState> {
  const lens = s.allLenses.find((l) => l.id === s.activeLensId);
  const existing = s.draftState.get(s.activeLensId);
  const next = new Map(s.draftState);

  if (text !== (lens?.filterText ?? "")) {
    next.set(s.activeLensId, { ...existing, filter: text });
    persistDrafts(next);
    return { draftState: next };
  }

  if (!existing) return s;
  const rest = draftWithoutFilter(existing);
  if (Object.keys(rest).length === 0) next.delete(s.activeLensId);
  else next.set(s.activeLensId, rest);
  persistDrafts(next);
  return { draftState: next };
}

/** The state that adopting a lens puts on screen. */
function adoptedLensState(lens: LensConfig): Partial<ViewState> {
  return {
    activeLensId: lens.id,
    sort: { ...lens.sort },
    grouping: lens.grouping,
    columnOrder: [...lens.columns],
  };
}

/**
 * The current view — columns, grouping, sort, filter text — as a new lens. Both
 * "Create lens", from scratch, and "Save as new lens", forked from the current
 * view, come through here; the name is the only difference.
 */
function lensFromSnapshot({
  name,
  overrides,
  state,
}: {
  name: string;
  overrides: Partial<LensDraftInput> | undefined;
  state: ViewState;
}): LensConfig {
  return {
    id: generateId(),
    name,
    isBuiltIn: false,
    columns: overrides?.columns ? [...overrides.columns] : [...state.columnOrder],
    addons: overrides?.addons ? [...overrides.addons] : [],
    grouping: overrides?.grouping ?? state.grouping,
    sort: overrides?.sort ? { ...overrides.sort } : { ...state.sort },
    filterText: overrides?.filterText ?? getCurrentFilterText(),
  };
}

/**
 * "All" is the lens of last resort: every other built-in or user lens can be
 * deleted or dismissed, but the strip must always offer a way back to the
 * unfiltered table.
 */
function isDeletableLens(s: ViewState, lensId: string): boolean {
  if (s.allLenses.length <= 1) return false;
  return lensId !== "all-traces";
}

/** A built-in is dismissed locally; a user lens is deleted on the server. */
function forgetLens(lens: LensConfig, lensId: string): void {
  if (!lens.isBuiltIn) {
    lensSyncBridge?.delete(lensId);
    return;
  }
  const dismissed = loadDismissedBuiltInIds();
  dismissed.add(lensId);
  persistDismissedBuiltInIds(dismissed);
}

/**
 * The persisted last-used lens may be a CUSTOM lens that only becomes available
 * once its project's lenses hydrate, possibly across several partial payloads,
 * so it is adopted here the moment it appears.
 */
function lateAdoptedPersistedLens(
  s: ViewState,
  allLenses: LensConfig[],
): Partial<ViewState> | null {
  const persisted = getPersistedActiveLensId();
  if (s.activeLensId !== "all-traces" || !persisted || persisted === s.activeLensId) return null;
  const target = allLenses.find((l) => l.id === persisted);
  if (!target) return null;
  const draft = s.draftState.get(persisted);
  applyFilterTextFromLens(draft?.filter ?? target.filterText);
  return {
    allLenses,
    activeLensId: persisted,
    sort: draft?.sort ?? target.sort,
    grouping: draft?.grouping ?? target.grouping,
    columnOrder: draft?.columns ?? target.columns,
  };
}

/**
 * The server's user lenses folded in beside the built-ins. When the active lens
 * disappeared — deleted in another tab, or by a teammate — the first available
 * one takes over.
 */
function mergedUserLenses(s: ViewState, lenses: LensConfig[]): Partial<ViewState> {
  const builtIns = s.allLenses.filter((l) => l.isBuiltIn);
  const allLenses = [...builtIns, ...lenses.map((l) => ({ ...l, isBuiltIn: false }))];

  const lateAdopted = lateAdoptedPersistedLens(s, allLenses);
  if (lateAdopted) return lateAdopted;

  if (allLenses.some((l) => l.id === s.activeLensId)) return { allLenses };
  const next = allLenses[0];
  if (!next) return { allLenses };
  applyFilterTextFromLens(next.filterText);
  return {
    allLenses,
    activeLensId: next.id,
    sort: next.sort,
    grouping: next.grouping,
    columnOrder: next.columns,
  };
}
