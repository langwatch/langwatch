/**
 * A temporary expanded/collapsed state for a sidebar section, set from
 * outside the section (the guided tour folds Build before its first step and
 * opens it when the cursor lands). An override sits in front of the user's
 * persisted preference and never writes to it, so clearing the override
 * puts the section back exactly how the user had it.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import { create } from "zustand";

interface SidebarSectionOverridesState {
  overrides: Record<string, boolean>;
  setOverride: (id: string, expanded: boolean) => void;
  clearOverride: (id: string) => void;
  clearAll: () => void;
}

export const useSidebarSectionOverrides =
  create<SidebarSectionOverridesState>()((set) => ({
    overrides: {},
    setOverride: (id, expanded) =>
      set((state) => ({ overrides: { ...state.overrides, [id]: expanded } })),
    clearOverride: (id) =>
      set((state) => {
        const { [id]: _, ...rest } = state.overrides;
        return { overrides: rest };
      }),
    clearAll: () => set({ overrides: {} }),
  }));
