/**
 * Whether the sidebar's From LangWatch group is folded: only the member's click folds or
 * opens it, and the choice is kept per signed-in reader (ARCHITECTURE §10.2).
 */

import { defineSlice } from "@langwatch/browser-host/global-store";

type FoldState = {
  folded: boolean;
  toggle: () => void;
};

const useFoldStore = defineSlice<FoldState>({
  name: "analytics:from-langwatch-fold",
  create: (set) => ({
    folded: false,
    toggle: () => set((state) => ({ folded: !state.folded })),
  }),
  persist: {
    key: "langwatch.dashboard.fromLangWatchFolded",
    partialize: ({ folded }) => ({ folded }),
  },
});

export function useCuratedFold() {
  const folded = useFoldStore((state) => state.folded);
  const toggle = useFoldStore((state) => state.toggle);
  return { folded, toggle };
}
