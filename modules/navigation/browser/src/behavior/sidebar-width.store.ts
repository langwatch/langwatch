import { defineSlice } from "@langwatch/browser-host/global-store";

export const SIDEBAR_WIDTH_SLICE = "navigation:sidebar-width";

interface SidebarWidthState {
  /** The width the reader dragged the sidebar to; null keeps the default. */
  rememberedWidth: number | null;
  setRememberedWidth: (width: number) => void;
  resetWidth: () => void;
}

/** The reader's sidebar width, persisted for them and forgotten at sign-out (§10.2). */
export const useSidebarWidthStore = defineSlice<SidebarWidthState>({
  name: SIDEBAR_WIDTH_SLICE,
  create: (set) => ({
    rememberedWidth: null,
    setRememberedWidth: (width) => set({ rememberedWidth: width }),
    resetWidth: () => set({ rememberedWidth: null }),
  }),
  persist: { partialize: ({ rememberedWidth }) => ({ rememberedWidth }) },
});
