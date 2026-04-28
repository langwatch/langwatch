import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  syntaxHelpOpen: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSyntaxHelpOpen: (open: boolean) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:ui";
type Persisted = Pick<UIState, "sidebarCollapsed">;

const DEFAULT_PERSISTED: Persisted = { sidebarCollapsed: true };

function loadPersistedUI(): Persisted {
  if (typeof window === "undefined") return DEFAULT_PERSISTED;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PERSISTED;
    const parsed = JSON.parse(stored) as Partial<Persisted>;
    return {
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
  sidebarCollapsed: initial.sidebarCollapsed,
  syntaxHelpOpen: false,

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    persistUI({ sidebarCollapsed: next });
    set({ sidebarCollapsed: next });
  },

  setSidebarCollapsed: (collapsed) => {
    persistUI({ sidebarCollapsed: collapsed });
    set({ sidebarCollapsed: collapsed });
  },

  setSyntaxHelpOpen: (open) => set({ syntaxHelpOpen: open }),
}));
