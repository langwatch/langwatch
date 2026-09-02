import { create } from "zustand";

type FindState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useFindStore = create<FindState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
