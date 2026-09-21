/**
 * A module store rather than context: the tour layer mounts once above every
 * page, and the drawer that types the key name is a portal. The tour only
 * ever calls what is registered right now.
 */
import { useEffect } from "react";
import { create } from "zustand";

import type { TourActions } from "../model/tour-actions.ts";

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
