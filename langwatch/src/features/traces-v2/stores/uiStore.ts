import { create } from "zustand";

export type Density = "compact" | "comfortable";

interface UIState {
  density: Density;
  sidebarCollapsed: boolean;

  setDensity: (d: Density) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:ui";
type Persisted = Pick<UIState, "density" | "sidebarCollapsed">;

const DEFAULT_PERSISTED: Persisted = { density: "compact", sidebarCollapsed: true };

function isDensity(value: unknown): value is Density {
  return value === "compact" || value === "comfortable";
}

function loadPersistedUI(): Persisted {
  if (typeof window === "undefined") return DEFAULT_PERSISTED;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PERSISTED;
    const parsed = JSON.parse(stored) as Partial<Persisted>;
    return {
      density: isDensity(parsed.density) ? parsed.density : DEFAULT_PERSISTED.density,
      sidebarCollapsed:
        typeof parsed.sidebarCollapsed === "boolean"
          ? parsed.sidebarCollapsed
          : DEFAULT_PERSISTED.sidebarCollapsed,
    };
  } catch {
    return DEFAULT_PERSISTED;
  }
}

function persistUI(state: Persisted): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage may be full / disabled
  }
}

const initial = loadPersistedUI();

export const useUIStore = create<UIState>((set, get) => ({
  density: initial.density,
  sidebarCollapsed: initial.sidebarCollapsed,

  setDensity: (density) => {
    persistUI({ density, sidebarCollapsed: get().sidebarCollapsed });
    set({ density });
  },

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    persistUI({ density: get().density, sidebarCollapsed: next });
    set({ sidebarCollapsed: next });
  },

  setSidebarCollapsed: (collapsed) => {
    persistUI({ density: get().density, sidebarCollapsed: collapsed });
    set({ sidebarCollapsed: collapsed });
  },
}));
