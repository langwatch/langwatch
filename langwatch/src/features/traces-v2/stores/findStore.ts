import { create } from "zustand";

interface FindState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useFindStore = create<FindState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
