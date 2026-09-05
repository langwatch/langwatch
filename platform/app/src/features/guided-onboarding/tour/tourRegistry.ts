/**
 * The actions a page lends to the guided tour. A page (or a drawer inside
 * it) registers what it can do on mount and takes it back on unmount, the
 * way `useRegisterLangyActions` lends UI actions to the agent. The tour only
 * ever calls what is registered right now, so a step whose page is gone does
 * nothing rather than reaching into a component that no longer exists.
 *
 * A module store rather than context: the tour layer is mounted once in the
 * Langy layout, above every page, and the drawer that types the key name is
 * a portal.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import { useEffect } from "react";
import { create } from "zustand";

export interface TourActions {
  expandGroup: (id: string) => void;
  collapseGroup: (id: string) => void;
  /** Puts every group the tour folded or opened back how the user had it. */
  restoreGroups: () => void;
  openVirtualKeyCreate: () => void;
  typeVirtualKeyName: (name: string) => void;
  submitVirtualKeyCreate: () => void;
  revealVirtualKeySecret: () => void;
}

interface TourRegistryState {
  actions: Partial<TourActions>;
  register: (actions: Partial<TourActions>) => () => void;
}

export const useTourRegistry = create<TourRegistryState>()((set, get) => ({
  actions: {},
  register: (actions) => {
    set({ actions: { ...get().actions, ...actions } });
    return () => {
      const remaining = { ...get().actions };
      for (const key of Object.keys(actions) as (keyof TourActions)[]) {
        if (remaining[key] === actions[key]) delete remaining[key];
      }
      set({ actions: remaining });
    };
  },
}));

/** What the tour can drive right now. */
export function getTourActions(): Partial<TourActions> {
  return useTourRegistry.getState().actions;
}

/**
 * Lends `actions` to the tour while the caller is mounted. Pass a memoised
 * object: a fresh one on every render re-registers on every render.
 */
export function useRegisterTourActions(actions: Partial<TourActions>) {
  useEffect(() => useTourRegistry.getState().register(actions), [actions]);
}
