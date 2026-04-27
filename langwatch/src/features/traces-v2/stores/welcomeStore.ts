import { create } from "zustand";

interface WelcomeState {
  isOpen: boolean;
  open: () => void;
  close: () => void;
}

export const useWelcomeStore = create<WelcomeState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));
