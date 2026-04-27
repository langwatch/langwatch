import { create } from "zustand";
import type { RowKind } from "../components/TraceTable/registry";

export type GroupingMode =
  | "flat"
  | "by-session"
  | "by-service"
  | "by-user"
  | "by-model";

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
  lockedFilters: string[];
  lockedGrouping?: boolean;
}

export function rowKindForGrouping(grouping: GroupingMode): RowKind {
  if (grouping === "by-session") return "conversation";
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

  isDraft: (lensId: string) => boolean;
  createLens: (name: string) => string;
  saveLens: (lensId: string) => void;
  revertLens: (lensId: string) => void;
  renameLens: (lensId: string, name: string) => void;
  duplicateLens: (lensId: string) => string;
  deleteLens: (lensId: string) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:lenses:v2";

function loadCustomLenses(): LensConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<LensConfig>>;
    return parsed.map((lens) => ({
      id: lens.id ?? "",
      name: lens.name ?? "Untitled",
      isBuiltIn: false,
      columns: lens.columns ?? [],
      addons: lens.addons ?? [],
      grouping: lens.grouping ?? "flat",
      sort: lens.sort ?? { columnId: "time", direction: "desc" },
      lockedFilters: lens.lockedFilters ?? [],
      lockedGrouping: lens.lockedGrouping,
    }));
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
    // Silently ignore storage errors
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
      "model",
      "evaluations",
      "events",
    ],
    addons: ["io-preview", "expanded-peek"],
    grouping: "flat",
    sort: { columnId: "time", direction: "desc" },
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
    grouping: "by-session",
    sort: { columnId: "time", direction: "desc" },
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
    sort: { columnId: "time", direction: "desc" },
    lockedFilters: ["traces.error"],
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
  {
    id: "by-service",
    name: "By Service",
    isBuiltIn: true,
    columns: ["group", "count", "duration", "cost", "tokens", "errors"],
    addons: ["group-traces"],
    grouping: "by-service",
    sort: { columnId: "count", direction: "desc" },
    lockedFilters: [],
    lockedGrouping: true,
  },
  {
    id: "by-user",
    name: "By User",
    isBuiltIn: true,
    columns: ["group", "count", "duration", "cost", "tokens", "errors"],
    addons: ["group-traces"],
    grouping: "by-user",
    sort: { columnId: "count", direction: "desc" },
    lockedFilters: [],
    lockedGrouping: true,
  },
];

const defaultColumnOrder = [
  "time",
  "trace",
  "service",
  "duration",
  "cost",
  "tokens",
  "model",
];

let idCounter = 0;

function generateId(): string {
  idCounter += 1;
  return `custom-${Date.now()}-${idCounter}`;
}

export const useViewStore = create<ViewState>((set, get) => ({
  activeLensId: "all-traces",
  allLenses: [...builtInLenses, ...loadCustomLenses()],
  sort: { columnId: "time", direction: "desc" },
  grouping: "flat",
  columnOrder: defaultColumnOrder,
  hiddenColumns: new Set<string>(),
  draftState: new Map<string, DraftLensState>(),

  selectLens: (id) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === id);
      if (!lens) return s;
      const draft = s.draftState.get(id);
      return {
        activeLensId: id,
        sort: draft?.sort ?? lens.sort,
        grouping: draft?.grouping ?? lens.grouping,
        columnOrder: draft?.columns ?? lens.columns,
        hiddenColumns: new Set<string>(),
      };
    }),

  setSort: (sort) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === s.activeLensId);
      if (lens && !lens.isBuiltIn) {
        const draft = s.draftState.get(s.activeLensId) ?? {};
        const next = new Map(s.draftState);
        next.set(s.activeLensId, { ...draft, sort });
        return { sort, draftState: next };
      }
      return { sort };
    }),

  setGrouping: (mode) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === s.activeLensId);
      if (lens && !lens.isBuiltIn) {
        const draft = s.draftState.get(s.activeLensId) ?? {};
        const next = new Map(s.draftState);
        next.set(s.activeLensId, { ...draft, grouping: mode });
        return { grouping: mode, draftState: next };
      }
      return { grouping: mode };
    }),

  toggleColumn: (columnId) =>
    set((s) => {
      const next = new Set(s.hiddenColumns);
      if (next.has(columnId)) {
        next.delete(columnId);
      } else {
        next.add(columnId);
      }
      const order = s.columnOrder.includes(columnId)
        ? s.columnOrder
        : [...s.columnOrder, columnId];

      const lens = s.allLenses.find((l) => l.id === s.activeLensId);
      if (lens && !lens.isBuiltIn) {
        const draft = s.draftState.get(s.activeLensId) ?? {};
        const nextDraft = new Map(s.draftState);
        nextDraft.set(s.activeLensId, { ...draft, columns: order });
        return { hiddenColumns: next, columnOrder: order, draftState: nextDraft };
      }
      return { hiddenColumns: next, columnOrder: order };
    }),

  reorderColumns: (fromIndex, toIndex) =>
    set((s) => {
      const order = [...s.columnOrder];
      const [moved] = order.splice(fromIndex, 1);
      if (moved) {
        order.splice(toIndex, 0, moved);
      }

      const lens = s.allLenses.find((l) => l.id === s.activeLensId);
      if (lens && !lens.isBuiltIn) {
        const draft = s.draftState.get(s.activeLensId) ?? {};
        const nextDraft = new Map(s.draftState);
        nextDraft.set(s.activeLensId, { ...draft, columns: order });
        return { columnOrder: order, draftState: nextDraft };
      }
      return { columnOrder: order };
    }),

  setVisibleColumns: (columns) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === s.activeLensId);
      if (lens && !lens.isBuiltIn) {
        const draft = s.draftState.get(s.activeLensId) ?? {};
        const nextDraft = new Map(s.draftState);
        nextDraft.set(s.activeLensId, { ...draft, columns });
        return {
          columnOrder: columns,
          hiddenColumns: new Set<string>(),
          draftState: nextDraft,
        };
      }
      return {
        columnOrder: columns,
        hiddenColumns: new Set<string>(),
      };
    }),

  isDraft: (lensId) => {
    return get().draftState.has(lensId);
  },

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
      lockedFilters: [],
    };
    const allLenses = [...state.allLenses, newLens];
    persistCustomLenses(allLenses);
    set({
      allLenses,
      activeLensId: id,
    });
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
      };
      const allLenses = s.allLenses.map((l) => (l.id === lensId ? updated : l));
      const nextDraft = new Map(s.draftState);
      nextDraft.delete(lensId);
      persistCustomLenses(allLenses);
      return { allLenses, draftState: nextDraft };
    }),

  revertLens: (lensId) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === lensId);
      if (!lens) return s;
      const nextDraft = new Map(s.draftState);
      nextDraft.delete(lensId);
      const isActive = s.activeLensId === lensId;
      return {
        draftState: nextDraft,
        ...(isActive
          ? {
              sort: lens.sort,
              grouping: lens.grouping,
              columnOrder: lens.columns,
              hiddenColumns: new Set<string>(),
            }
          : {}),
      };
    }),

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
    const newLens: LensConfig = {
      ...lens,
      id,
      name: `${lens.name} (copy)`,
      isBuiltIn: false,
    };
    const allLenses = [...state.allLenses, newLens];
    persistCustomLenses(allLenses);
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

  deleteLens: (lensId) =>
    set((s) => {
      const lens = s.allLenses.find((l) => l.id === lensId);
      if (!lens || lens.isBuiltIn) return s;
      const allLenses = s.allLenses.filter((l) => l.id !== lensId);
      const nextDraft = new Map(s.draftState);
      nextDraft.delete(lensId);
      const switchToFirst = s.activeLensId === lensId;
      const firstLens = allLenses[0]!;
      persistCustomLenses(allLenses);
      return {
        allLenses,
        draftState: nextDraft,
        ...(switchToFirst
          ? {
              activeLensId: firstLens.id,
              sort: firstLens.sort,
              grouping: firstLens.grouping,
              columnOrder: firstLens.columns,
              hiddenColumns: new Set<string>(),
            }
          : {}),
      };
    }),
}));

export function getActiveLens(state: ViewState): LensConfig {
  return (
    state.allLenses.find((l) => l.id === state.activeLensId) ??
    builtInLenses[0]!
  );
}
