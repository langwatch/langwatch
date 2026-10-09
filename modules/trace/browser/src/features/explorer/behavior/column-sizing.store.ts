import { defineSlice } from "@langwatch/browser-host/global-store";

/**
 * Per-lens column-width overrides. Keyed by `${lensId}:${rowKind}` so the "all-traces"
 * lens with the trace row kind doesn't collide with the conversations lens (same column
 * ids — `duration`, `cost` — but a different layout).
 */
type ColumnSizing = Record<string, number>;

interface ColumnSizingState {
  byKey: Record<string, ColumnSizing>;
  setSizing: (key: string, sizing: ColumnSizing) => void;
}

/** The reader's column widths, persisted for them and forgotten at sign-out (§10.2). */
export const useColumnSizingStore = defineSlice<ColumnSizingState>({
  name: "trace:column-sizing",
  create: (set) => ({
    byKey: {},
    setSizing: (key, sizing) =>
      set((s) => {
        // Drop entries that match the column's default width (no override)
        // before writing, so TanStack's updates don't grow the persisted blob.
        const cleaned: ColumnSizing = {};
        for (const [colId, px] of Object.entries(sizing)) {
          if (typeof px === "number" && px > 0) {
            cleaned[colId] = Math.round(px);
          }
        }
        return { byKey: { ...s.byKey, [key]: cleaned } };
      }),
  }),
  persist: { partialize: ({ byKey }) => ({ byKey }) },
});

export function getColumnSizingKey(
  lensId: string,
  rowKind: "trace" | "conversation" | "group",
): string {
  return `${lensId}:${rowKind}`;
}
