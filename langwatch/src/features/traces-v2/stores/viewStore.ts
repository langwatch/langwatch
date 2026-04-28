import { create } from "zustand";
import type { RowKind } from "../components/TraceTable/registry";
import { useFilterStore } from "./filterStore";

export type GroupingMode =
  | "flat"
  | "by-conversation"
  | "by-service"
  | "by-user"
  | "by-model";

// Density is no longer a per-lens or per-view setting — it's a global user
// preference managed by `densityStore.ts`. The `recommendedDensity` field
// on a lens is advisory only (future "use the recommended density?" prompt).
import type { Density } from "./densityStore";
export type { Density };

export interface SortConfig {
  columnId: string;
  direction: "asc" | "desc";
}

export interface ColumnConfig {
  id: string;
  label: string;
  section: "standard" | "evaluations" | "events";
  visible: boolean;
  pinned?: "left";
  minWidth: number;
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
  /**
   * Saved filter expression (Liqe query text). Optional for back-compat with
   * lenses persisted before filter capture was wired up — read as `""` when
   * absent. Built-in lenses leave this empty; their structural intent is
   * encoded via `lockedFilters` instead.
   */
  filterText?: string;
  /**
   * Optional density hint — purely advisory. Density is a global user
   * preference (see `densityStore`); this field never overrides it.
   * Lenses created before this change may still have a `density` field in
   * localStorage; it's read into `recommendedDensity` for back-compat.
   */
  recommendedDensity?: Density;
  lockedFilters: string[];
  lockedGrouping?: boolean;
}

export function getEffectiveLens(state: {
  allLenses: LensConfig[];
  activeLensId: string;
  sort: SortConfig;
  grouping: GroupingMode;
  columnOrder: string[];
}): LensConfig | null {
  const lens =
    state.allLenses.find((l) => l.id === state.activeLensId) ??
    state.allLenses[0];
  if (!lens) return null;
  return {
    ...lens,
    sort: state.sort,
    grouping: state.grouping,
    columns: state.columnOrder.length > 0 ? state.columnOrder : lens.columns,
  };
}

export function rowKindForGrouping(grouping: GroupingMode): RowKind {
  if (grouping === "by-conversation") return "conversation";
  if (grouping === "flat") return "trace";
  return "group";
}

export function groupByForGrouping(
  grouping: GroupingMode,
): "service" | "model" | "user" | null {
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

interface ViewState {
  activeLensId: string;
  allLenses: LensConfig[];
  sort: SortConfig;
  grouping: GroupingMode;
  columnOrder: string[];
  hiddenColumns: Set<string>;
  draftState: Map<string, DraftLensState>;

  selectLens: (id: string) => void;
  setSort: (sort: SortConfig) => void;
  setGrouping: (mode: GroupingMode) => void;
  toggleColumn: (columnId: string) => void;
  reorderColumns: (fromIndex: number, toIndex: number) => void;
  setVisibleColumns: (columns: string[]) => void;
  setFilterDraft: (text: string) => void;

  isDraft: (lensId: string) => boolean;
  createLens: (name: string) => string;
  saveLens: (lensId: string) => void;
  saveAsNewLens: (name: string) => string;
  revertLens: (lensId: string) => void;
  renameLens: (lensId: string, name: string) => void;
  duplicateLens: (lensId: string) => string;
  deleteLens: (lensId: string) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:lenses:v2";
const DISMISSED_BUILTINS_KEY = "langwatch:traces-v2:dismissed-builtins:v1";
const DRAFTS_KEY = "langwatch:traces-v2:drafts:v1";

const DEFAULT_SORT: SortConfig = { columnId: "time", direction: "desc" };

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

function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "comfortable";
}

function loadCustomLenses(): LensConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<LensConfig>>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((lens) => {
      // Back-compat: pre-migration lenses had a required `density` field.
      // Read it as a recommendation only; the global density store wins.
      const legacyDensity = (lens as { density?: unknown }).density;
      const recommended = isDensity(legacyDensity)
        ? legacyDensity
        : isDensity(lens.recommendedDensity)
          ? lens.recommendedDensity
          : undefined;
      return {
        id: lens.id ?? "",
        name: lens.name ?? "Untitled",
        isBuiltIn: false,
        columns: Array.isArray(lens.columns) ? lens.columns : [],
        addons: Array.isArray(lens.addons) ? lens.addons : [],
        grouping: migrateGrouping(lens.grouping) ?? "flat",
        sort: lens.sort ?? DEFAULT_SORT,
        filterText: typeof lens.filterText === "string" ? lens.filterText : "",
        recommendedDensity: recommended,
        lockedFilters: Array.isArray(lens.lockedFilters)
          ? lens.lockedFilters
          : [],
        lockedGrouping: lens.lockedGrouping,
      };
    });
  } catch {
    return [];
  }
}

function persistCustomLenses(allLenses: LensConfig[]): void {
  if (typeof window === "undefined") return;
  try {
    const custom = allLenses.filter((l) => !l.isBuiltIn);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(custom));
  } catch {
    // storage may be full / disabled
  }
}

function isSortConfig(value: unknown): value is SortConfig {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.columnId === "string" &&
    (v.direction === "asc" || v.direction === "desc")
  );
}

function loadDrafts(): Map<string, DraftLensState> {
  if (typeof window === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(DRAFTS_KEY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return new Map();
    const out = new Map<string, DraftLensState>();
    for (const [lensId, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") continue;
      const v = value as Record<string, unknown>;
      const draft: DraftLensState = {};
      if (isSortConfig(v.sort)) draft.sort = v.sort;
      const grouping = migrateGrouping(v.grouping);
      if (grouping) draft.grouping = grouping;
      if (Array.isArray(v.columns)) {
        draft.columns = v.columns.filter(
          (c): c is string => typeof c === "string",
        );
      }
      if (typeof v.filter === "string") draft.filter = v.filter;
      if (Object.keys(draft).length > 0) out.set(lensId, draft);
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
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(obj));
  } catch {
    // storage may be full / disabled
  }
}

function loadDismissedBuiltInIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(DISMISSED_BUILTINS_KEY);
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
    localStorage.setItem(DISMISSED_BUILTINS_KEY, JSON.stringify([...ids]));
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
      "service",
      "duration",
      "cost",
      "tokens",
      "spans",
      "model",
      "evaluations",
      "events",
    ],
    addons: ["io-preview", "expanded-peek"],
    grouping: "flat",
    sort: DEFAULT_SORT,

    lockedFilters: [],
  },
  {
    id: "conversations",
    name: "Conversations",
    isBuiltIn: true,
    columns: [
      "conversation",
      "turns",
      "duration",
      "cost",
      "tokens",
      "model",
      "service",
      "status",
    ],
    addons: ["conversation-turns"],
    grouping: "by-conversation",
    sort: DEFAULT_SORT,
    recommendedDensity: "comfortable",
    lockedFilters: ["metadata.thread_id"],
    lockedGrouping: true,
  },
  {
    id: "errors",
    name: "Errors",
    isBuiltIn: true,
    columns: [
      "time",
      "trace",
      "service",
      "duration",
      "cost",
      "model",
      "evaluations",
      "events",
    ],
    addons: ["error-detail", "expanded-peek"],
    grouping: "flat",
    sort: DEFAULT_SORT,

    lockedFilters: ["traces.error"],
  },
  {
    id: "slow-requests",
    name: "Slow requests",
    isBuiltIn: true,
    columns: [
      "time",
      "trace",
      "service",
      "model",
      "duration",
      "tokens",
      "cost",
    ],
    addons: ["error-detail", "io-preview"],
    grouping: "flat",
    sort: { columnId: "duration", direction: "desc" },

    lockedFilters: [],
  },
  {
    id: "quality-review",
    name: "Quality review",
    isBuiltIn: true,
    columns: ["time", "trace", "input", "output", "evaluations", "events"],
    addons: ["io-preview"],
    grouping: "flat",
    sort: DEFAULT_SORT,
    recommendedDensity: "comfortable",
    lockedFilters: ["evaluations.status"],
  },
  {
    id: "by-model",
    name: "By Model",
    isBuiltIn: true,
    columns: ["group", "count", "duration", "cost", "tokens", "errors"],
    addons: ["group-traces"],
    grouping: "by-model",
    sort: { columnId: "count", direction: "desc" },

    lockedFilters: [],
    lockedGrouping: true,
  },
];

const defaultColumnOrder: string[] = [
  "time",
  "trace",
  "service",
  "duration",
  "cost",
  "tokens",
  "spans",
  "model",
];

let idCounter = 0;
function generateId(): string {
  idCounter += 1;
  return `custom-${Date.now()}-${idCounter}`;
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

function getCurrentFilterText(): string {
  try {
    return useFilterStore.getState().queryText;
  } catch {
    return "";
  }
}

function applyFilterTextSilently(text: string): void {
  try {
    useFilterStore.getState().setFilterFromLens(text);
  } catch {
    // filterStore unavailable (e.g. SSR boot) — safe to skip.
  }
}

const initialDismissedBuiltIns = loadDismissedBuiltInIds();
const initialLenses: LensConfig[] = [
  ...builtInLenses.filter((l) => !initialDismissedBuiltIns.has(l.id)),
  ...loadCustomLenses(),
];
const initialActiveLensId =
  initialLenses.find((l) => l.id === "all-traces")?.id ??
  initialLenses[0]?.id ??
  "all-traces";
const initialDrafts = loadDrafts();
const initialActiveLens = initialLenses.find(
  (l) => l.id === initialActiveLensId,
);
const initialActiveDraft = initialDrafts.get(initialActiveLensId);

export const useViewStore = create<ViewState>((set, get) => ({
  activeLensId: initialActiveLensId,
  allLenses: initialLenses,
  sort: initialActiveDraft?.sort ?? initialActiveLens?.sort ?? DEFAULT_SORT,
  grouping:
    initialActiveDraft?.grouping ?? initialActiveLens?.grouping ?? "flat",
  columnOrder:
    initialActiveDraft?.columns ??
    initialActiveLens?.columns ??
    defaultColumnOrder,
  hiddenColumns: new Set<string>(),
  draftState: initialDrafts,

  selectLens: (id) => {
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === id);
      if (!lens) return s;
      const draft = s.draftState.get(id);
      // Apply the lens's filter (or its draft override) to filterStore via
      // the silent setter — `applyQueryText` would loop back through
      // `setFilterDraft` and immediately mark the lens dirty.
      const nextFilter = draft?.filter ?? lens.filterText ?? "";
      applyFilterTextSilently(nextFilter);
      return {
        activeLensId: id,
        sort: draft?.sort ?? lens.sort,
        grouping: draft?.grouping ?? lens.grouping,
        columnOrder: draft?.columns ?? lens.columns,
        hiddenColumns: new Set<string>(),
      };
    });
  },

  // Every per-view tweak goes through `draftState` regardless of whether
  // the active lens is built-in or custom. The "unsaved" dot on the lens
  // tab keys off `isDraft(lensId)`, so showing it for built-ins requires
  // tracking those drafts too. Built-in lenses can't be saved into
  // localStorage (the menu's Save item stays disabled), but the user can
  // duplicate to keep the changes.
  setSort: (sort) =>
    set((s) => ({
      sort,
      draftState: setDraft(s.draftState, s.activeLensId, { sort }),
    })),

  setGrouping: (mode) =>
    set((s) => ({
      grouping: mode,
      draftState: setDraft(s.draftState, s.activeLensId, { grouping: mode }),
    })),

  toggleColumn: (columnId) =>
    set((s) => {
      // columnOrder is the only thing the lens bodies read. hiddenColumns
      // was a parallel "soft hide" state but nothing rendered against it,
      // so toggling it never actually showed or hid columns. Operate on
      // columnOrder directly: present → remove; absent → append.
      const order = s.columnOrder.includes(columnId)
        ? s.columnOrder.filter((id) => id !== columnId)
        : [...s.columnOrder, columnId];

      const nextHidden = new Set(s.hiddenColumns);
      nextHidden.delete(columnId);

      return {
        columnOrder: order,
        hiddenColumns: nextHidden,
        draftState: setDraft(s.draftState, s.activeLensId, { columns: order }),
      };
    }),

  reorderColumns: (fromIndex, toIndex) =>
    set((s) => {
      if (
        fromIndex === toIndex ||
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= s.columnOrder.length ||
        toIndex >= s.columnOrder.length
      ) {
        return s;
      }
      const order = [...s.columnOrder];
      const [moved] = order.splice(fromIndex, 1);
      if (!moved) return s;
      order.splice(toIndex, 0, moved);

      return {
        columnOrder: order,
        draftState: setDraft(s.draftState, s.activeLensId, { columns: order }),
      };
    }),

  setVisibleColumns: (columns) =>
    set((s) => ({
      columnOrder: columns,
      hiddenColumns: new Set<string>(),
      draftState: setDraft(s.draftState, s.activeLensId, { columns }),
    })),

  setFilterDraft: (text) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === s.activeLensId);
      const saved = lens?.filterText ?? "";
      // If the new filter matches the lens's saved value, drop the draft
      // entry rather than carrying an empty/no-op marker around. We
      // preserve any other draft fields (sort/grouping/columns) on this
      // lens by only clearing when the resulting draft would be empty.
      const existing = s.draftState.get(s.activeLensId);
      const next = new Map(s.draftState);
      if (text === saved) {
        if (!existing) return s;
        const rest: DraftLensState = {};
        if (existing.sort !== undefined) rest.sort = existing.sort;
        if (existing.grouping !== undefined) rest.grouping = existing.grouping;
        if (existing.columns !== undefined) rest.columns = existing.columns;
        if (Object.keys(rest).length === 0) {
          next.delete(s.activeLensId);
        } else {
          next.set(s.activeLensId, rest);
        }
        persistDrafts(next);
        return { draftState: next };
      }
      next.set(s.activeLensId, { ...(existing ?? {}), filter: text });
      persistDrafts(next);
      return { draftState: next };
    }),

  isDraft: (lensId) => get().draftState.has(lensId),

  createLens: (name) => {
    const id = generateId();
    const state = get();
    const newLens: LensConfig = {
      id,
      name,
      isBuiltIn: false,
      columns: [...state.columnOrder],
      addons: [],
      grouping: state.grouping,
      sort: { ...state.sort },
      filterText: getCurrentFilterText(),
      lockedFilters: [],
    };
    const allLenses = [...state.allLenses, newLens];
    persistCustomLenses(allLenses);
    set({ allLenses, activeLensId: id });
    return id;
  },

  saveLens: (lensId) =>
    set((s) => {
      const draft = s.draftState.get(lensId);
      if (!draft) return s;
      const lens = s.allLenses.find((l) => l.id === lensId);
      if (!lens || lens.isBuiltIn) return s;

      const updated: LensConfig = {
        ...lens,
        sort: draft.sort ?? lens.sort,
        grouping: draft.grouping ?? lens.grouping,
        columns: draft.columns ?? lens.columns,
        filterText: draft.filter ?? lens.filterText ?? getCurrentFilterText(),
      };
      const allLenses = s.allLenses.map((l) => (l.id === lensId ? updated : l));
      const nextDraft = clearDraftFor(s.draftState, lensId);
      persistCustomLenses(allLenses);
      return { allLenses, draftState: nextDraft };
    }),

  saveAsNewLens: (name) => {
    const id = generateId();
    const state = get();
    const newLens: LensConfig = {
      id,
      name,
      isBuiltIn: false,
      columns: [...state.columnOrder],
      addons: [],
      grouping: state.grouping,
      sort: { ...state.sort },
      filterText: getCurrentFilterText(),
      lockedFilters: [],
    };
    const allLenses = [...state.allLenses, newLens];
    persistCustomLenses(allLenses);
    set({ allLenses, activeLensId: id });
    return id;
  },

  revertLens: (lensId) => {
    const s = get();
    const lens = s.allLenses.find((l) => l.id === lensId);
    if (!lens) return;
    const nextDraft = clearDraftFor(s.draftState, lensId);
    if (s.activeLensId !== lensId) {
      set({ draftState: nextDraft });
      return;
    }
    applyFilterTextSilently(lens.filterText ?? "");
    set({
      draftState: nextDraft,
      sort: lens.sort,
      grouping: lens.grouping,
      columnOrder: lens.columns,
      hiddenColumns: new Set<string>(),
    });
  },

  renameLens: (lensId, name) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === lensId);
      if (!lens || lens.isBuiltIn) return s;
      const allLenses = s.allLenses.map((l) =>
        l.id === lensId ? { ...l, name } : l,
      );
      persistCustomLenses(allLenses);
      return { allLenses };
    }),

  duplicateLens: (lensId) => {
    const state = get();
    const lens = state.allLenses.find((l) => l.id === lensId);
    if (!lens) return lensId;
    const id = generateId();
    // Duplicate the SAVED lens — never the live draft. The
    // "Save as new lens" action handles the draft-capture case.
    const newLens: LensConfig = {
      ...lens,
      id,
      name: `${lens.name} (copy)`,
      isBuiltIn: false,
      filterText: lens.filterText ?? "",
    };
    const allLenses = [...state.allLenses, newLens];
    persistCustomLenses(allLenses);
    applyFilterTextSilently(newLens.filterText ?? "");
    set({
      allLenses,
      activeLensId: id,
      sort: { ...newLens.sort },
      grouping: newLens.grouping,
      columnOrder: [...newLens.columns],
      hiddenColumns: new Set<string>(),
    });
    return id;
  },

  deleteLens: (lensId) => {
    const s = get();
    const lens = s.allLenses.find((l) => l.id === lensId);
    if (!lens) return;
    if (s.allLenses.length <= 1) return;
    const allLenses = s.allLenses.filter((l) => l.id !== lensId);
    const nextDraft = clearDraftFor(s.draftState, lensId);
    if (lens.isBuiltIn) {
      const dismissed = loadDismissedBuiltInIds();
      dismissed.add(lensId);
      persistDismissedBuiltInIds(dismissed);
    } else {
      persistCustomLenses(allLenses);
    }
    if (s.activeLensId !== lensId) {
      set({ allLenses, draftState: nextDraft });
      return;
    }
    const firstLens = allLenses[0];
    if (!firstLens) return;
    applyFilterTextSilently(firstLens.filterText ?? "");
    set({
      allLenses,
      draftState: nextDraft,
      activeLensId: firstLens.id,
      sort: firstLens.sort,
      grouping: firstLens.grouping,
      columnOrder: firstLens.columns,
      hiddenColumns: new Set<string>(),
    });
  },
}));
