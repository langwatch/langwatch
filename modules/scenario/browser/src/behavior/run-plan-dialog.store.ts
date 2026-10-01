import { create } from "zustand";

type RunPlanDialogStore = {
  /** The stored plan the dialog is open on, "new" for one being written. */
  openOn: { kind: "new" } | { kind: "plan"; suiteId: string } | null;
  openNew: () => void;
  openPlan: (suiteId: string) => void;
  close: () => void;
};

export const useRunPlanDialogStore = create<RunPlanDialogStore>((set) => ({
  openOn: null,
  openNew: () => set({ openOn: { kind: "new" } }),
  openPlan: (suiteId) => set({ openOn: { kind: "plan", suiteId } }),
  close: () => set({ openOn: null }),
}));
