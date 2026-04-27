import { create } from "zustand";

export type Density = "compact" | "comfortable";

interface UIState {
  density: Density;
  sidebarCollapsed: boolean;

  setDensity: (d: Density) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

function loadPersistedUI(): Pick<UIState, "density" | "sidebarCollapsed"> {
  if (typeof window === "undefined") {
    return { density: "compact", sidebarCollapsed: true };
  }
  try {
    const stored = localStorage.getItem("langwatch:traces-v2:ui");
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<
        Pick<UIState, "density" | "sidebarCollapsed">
      >;
      return {
        density: parsed.density ?? "compact",
        sidebarCollapsed: parsed.sidebarCollapsed ?? true,
      };
    }
  } catch {
    // ignore
  }
  return { density: "compact", sidebarCollapsed: true };
}

function persistUI(state: Pick<UIState, "density" | "sidebarCollapsed">) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      "langwatch:traces-v2:ui",
      JSON.stringify({ density: state.density, sidebarCollapsed: state.sidebarCollapsed })
    );
  } catch {
    // ignore
  }
}

const initial = loadPersistedUI();

export const useUIStore = create<UIState>((set) => ({
  density: initial.density,
  sidebarCollapsed: initial.sidebarCollapsed,

  setDensity: (density) =>
    set((s) => {
      const next = { ...s, density };
      persistUI(next);
      return { density };
    }),

  toggleSidebar: () =>
    set((s) => {
      const next = { ...s, sidebarCollapsed: !s.sidebarCollapsed };
      persistUI(next);
      return { sidebarCollapsed: !s.sidebarCollapsed };
    }),

  setSidebarCollapsed: (collapsed) =>
    set((s) => {
      const next = { ...s, sidebarCollapsed: collapsed };
      persistUI(next);
      return { sidebarCollapsed: collapsed };
    }),
}));
