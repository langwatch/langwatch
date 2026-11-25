/**
 * Which library groups the member opened past eight with "Show N more": only their click opens
 * or folds one, and the choice is kept per signed-in reader across reloads (ARCHITECTURE §10.2).
 * @see modules/dashboard/specs/dashboards-organization-area.feature
 */

import { defineSlice } from "@langwatch/browser-host/global-store";
import type { DashboardHomeProduct } from "@langwatch/dashboard-contract";

type ShowMoreState = {
  opened: readonly DashboardHomeProduct[];
  toggle: (product: DashboardHomeProduct) => void;
};

const useShowMoreStore = defineSlice<ShowMoreState>({
  name: "analytics:library-show-more",
  create: (set) => ({
    opened: [],
    toggle: (product) =>
      set(({ opened }) => ({
        opened: opened.includes(product)
          ? opened.filter((candidate) => candidate !== product)
          : [...opened, product],
      })),
  }),
  persist: {
    key: "langwatch.dashboard.libraryShowMore",
    partialize: ({ opened }) => ({ opened }),
  },
});

/** Whether `product`'s group lists every board, and the toggle its "Show N more" presses. */
export function useLibraryShowMore(product: DashboardHomeProduct) {
  const showsAll = useShowMoreStore((state) => state.opened.includes(product));
  const toggle = useShowMoreStore((state) => state.toggle);
  return { showsAll, toggle: () => toggle(product) };
}
