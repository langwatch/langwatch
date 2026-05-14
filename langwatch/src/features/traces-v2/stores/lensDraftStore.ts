import { create } from "zustand";
import {
  getCapability,
  reconcileAddons,
  reconcileColumns,
  reconcileSort,
} from "../lens/capabilities";
import type { LensDraft } from "../lens/schema";
import { lensDraftSchema } from "../lens/schema";
import type { GroupingMode, SortConfig } from "./viewStore";

/**
 * State machine for the rich "New lens" dialog.
 *
 * The dialog is intentionally a thin view over this store: every interaction
 * lands as a typed action, and the store keeps the in-flight draft consistent
 * with the active grouping's capabilities (e.g. switching from Flat to
 * By Model auto-prunes columns/addons/sort the new mode can't render). The
 * end-of-flow `submit()` runs the draft through the Zod schema before
 * returning it, so the caller never has to defensively re-validate.
 */

export interface LensDraftSeed {
  /** Pre-fills name when the user invokes the dialog from a specific context. */
  name?: string;
  grouping: GroupingMode;
  columns: string[];
  addons: string[];
  sort: SortConfig;
  /** Current SearchBar filter text — saved when `includeFilter` is true. */
  liveFilterText: string;
}

interface LensDraftState {
  open: boolean;
  /** True after the user has interacted at least once — drives error display. */
  touched: boolean;
  draft: LensDraft;
  /** When false, the lens is created with an empty filter regardless of seed. */
  includeFilter: boolean;
  /** Snapshot of the SearchBar's filter text when the dialog opened. */
  liveFilterText: string;

  openDialog: (seed: LensDraftSeed) => void;
  closeDialog: () => void;

  setName: (name: string) => void;
  setGrouping: (grouping: GroupingMode) => void;
  toggleColumn: (columnId: string) => void;
  toggleAddon: (addonId: string) => void;
  setSortColumn: (columnId: string) => void;
  setSortDirection: (direction: "asc" | "desc") => void;
  setIncludeFilter: (include: boolean) => void;

  /**
   * Validate the current draft. Returns the parsed `LensDraft` on success or
   * a list of human-readable error messages on failure. Pure — does not mutate.
   */
  validate: () => { ok: true; draft: LensDraft } | { ok: false; errors: string[] };
}

const EMPTY_DRAFT: LensDraft = {
  name: "",
  grouping: "flat",
  columns: [],
  addons: [],
  sort: { columnId: "time", direction: "desc" },
  filterText: "",
};

/**
 * Build a draft from a seed by reconciling each field against the capability
 * descriptor. Centralising this here means `openDialog` and `setGrouping`
 * share one normalisation path and can't drift.
 */
function reconcileDraft(
  partial: Partial<LensDraft> & { grouping: GroupingMode },
  liveFilterText: string,
  includeFilter: boolean,
): LensDraft {
  const capability = getCapability(partial.grouping);
  return {
    name: partial.name ?? "",
    grouping: partial.grouping,
    columns: reconcileColumns(partial.columns ?? capability.defaultColumns, capability),
    addons: reconcileAddons(partial.addons ?? [], capability),
    sort: reconcileSort(partial.sort ?? capability.defaultSort, capability),
    filterText: includeFilter ? liveFilterText : "",
  };
}

export const useLensDraftStore = create<LensDraftState>((set, get) => ({
  open: false,
  touched: false,
  draft: EMPTY_DRAFT,
  includeFilter: true,
  liveFilterText: "",

  openDialog: (seed) => {
    const draft = reconcileDraft(
      {
        name: seed.name,
        grouping: seed.grouping,
        columns: seed.columns,
        addons: seed.addons,
        sort: seed.sort,
      },
      seed.liveFilterText,
      true,
    );
    set({
      open: true,
      touched: false,
      draft,
      includeFilter: true,
      liveFilterText: seed.liveFilterText,
    });
  },

  closeDialog: () => set({ open: false, touched: false }),

  setName: (name) =>
    set((s) => ({ touched: true, draft: { ...s.draft, name } })),

  setGrouping: (grouping) => {
    set((s) => {
      const next = reconcileDraft(
        {
          name: s.draft.name,
          grouping,
          // Carry forward whatever the user had — `reconcileDraft` will drop
          // ids the new grouping doesn't expose and fall back to defaults if
          // nothing survives.
          columns: s.draft.columns,
          addons: s.draft.addons,
          sort: s.draft.sort,
        },
        s.liveFilterText,
        s.includeFilter,
      );
      return { touched: true, draft: next };
    });
  },

  toggleColumn: (columnId) =>
    set((s) => {
      const capability = getCapability(s.draft.grouping);
      const def = capability.columns.find((c) => c.id === columnId);
      // Pinned columns can't be toggled off — silently ignore.
      if (def?.pinned) return s;
      const has = s.draft.columns.includes(columnId);
      const columns = has
        ? s.draft.columns.filter((id) => id !== columnId)
        : [...s.draft.columns, columnId];
      return { touched: true, draft: { ...s.draft, columns } };
    }),

  toggleAddon: (addonId) =>
    set((s) => {
      const has = s.draft.addons.includes(addonId);
      const addons = has
        ? s.draft.addons.filter((id) => id !== addonId)
        : [...s.draft.addons, addonId];
      return { touched: true, draft: { ...s.draft, addons } };
    }),

  setSortColumn: (columnId) =>
    set((s) => ({
      touched: true,
      draft: { ...s.draft, sort: { ...s.draft.sort, columnId } },
    })),

  setSortDirection: (direction) =>
    set((s) => ({
      touched: true,
      draft: { ...s.draft, sort: { ...s.draft.sort, direction } },
    })),

  setIncludeFilter: (include) =>
    set((s) => ({
      touched: true,
      includeFilter: include,
      draft: {
        ...s.draft,
        filterText: include ? s.liveFilterText : "",
      },
    })),

  validate: () => {
    const result = lensDraftSchema.safeParse(get().draft);
    if (result.success) return { ok: true, draft: result.data };
    return {
      ok: false,
      errors: result.error.issues.map((i) => i.message),
    };
  },
}));
