import { create } from "zustand";

/**
 * Per-lens column-width overrides. Keyed by `${lensId}:${rowKind}` so the
 * "all-traces" lens with the trace row kind doesn't collide with the
 * conversations lens (same column ids — `duration`, `cost` — but a
 * different layout). Persisted to localStorage so widths survive page
 * reloads; cleared per-lens via `resetForLens` from the column menu.
 */
export type ColumnSizing = Record<string, number>;

interface ColumnSizingState {
  byKey: Record<string, ColumnSizing>;
  setSizing: (key: string, sizing: ColumnSizing) => void;
  resetForKey: (key: string) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:column-sizing:v1";

function load(): Record<string, ColumnSizing> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, ColumnSizing> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!v || typeof v !== "object") continue;
      const sizing: ColumnSizing = {};
      for (const [colId, px] of Object.entries(v as Record<string, unknown>)) {
        if (typeof px === "number" && Number.isFinite(px) && px > 0) {
          sizing[colId] = Math.round(px);
        }
      }
      if (Object.keys(sizing).length > 0) out[k] = sizing;
    }
    return out;
  } catch {
    return {};
  }
}

function persist(byKey: Record<string, ColumnSizing>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(byKey));
  } catch {
    // storage may be full / disabled
  }
}

export const useColumnSizingStore = create<ColumnSizingState>((set) => ({
  byKey: load(),
  setSizing: (key, sizing) =>
    set((s) => {
      // Drop entries that match the column's default width (no override)
      // before writing. Without this, every TanStack-emitted update grows
      // the persisted blob with zero-information entries.
      const cleaned: ColumnSizing = {};
      for (const [colId, px] of Object.entries(sizing)) {
        if (typeof px === "number" && px > 0) cleaned[colId] = Math.round(px);
      }
      const next = { ...s.byKey, [key]: cleaned };
      persist(next);
      return { byKey: next };
    }),
  resetForKey: (key) =>
    set((s) => {
      if (!(key in s.byKey)) return s;
      const next = { ...s.byKey };
      delete next[key];
      persist(next);
      return { byKey: next };
    }),
}));

export function getColumnSizingKey(
  lensId: string,
  rowKind: "trace" | "conversation" | "group",
): string {
  return `${lensId}:${rowKind}`;
}
