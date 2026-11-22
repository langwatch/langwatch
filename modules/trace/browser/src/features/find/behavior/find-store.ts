import { defineSlice } from "@langwatch/browser-host/global-store";

type FindState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

export const useFindStore = defineSlice<FindState>({
  name: "trace:find",
  create: (set) => ({
    isOpen: false,
    open: () => set({ isOpen: true }),
    close: () => set({ isOpen: false }),
  }),
});
