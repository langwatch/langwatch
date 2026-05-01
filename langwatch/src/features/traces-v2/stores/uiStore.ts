import { create } from "zustand";

/**
 * Cross-feature UI prefs for the traces-v2 page that aren't tied to
 * onboarding state. Everything onboarding-related (setup dismissal,
 * tour active, journey completion flags, stage machinery) lives in
 * `onboarding/store/onboardingStore.ts` and is reached via the
 * onboarding module's public API.
 */
interface UIState {
  sidebarCollapsed: boolean;
  syntaxHelpOpen: boolean;
  shortcutsHelpOpen: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSyntaxHelpOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  toggleShortcutsHelp: () => void;
}

const STORAGE_KEY = "langwatch:traces-v2:ui";
type Persisted = Pick<UIState, "sidebarCollapsed">;

const DEFAULT_PERSISTED: Persisted = {
  sidebarCollapsed: true,
};

function loadPersistedUI(): Persisted {
  if (typeof window === "undefined") return DEFAULT_PERSISTED;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PERSISTED;
    // Old shape stored `setupDismissedByProject` here too — onboardingStore
    // now owns that field and migrates it on its own first load. Pull just
    // sidebarCollapsed off; ignore anything else.
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

function persistUI(snapshot: Persisted): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // storage may be full / disabled
  }
}

const initial = loadPersistedUI();

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: initial.sidebarCollapsed,
  syntaxHelpOpen: false,
  shortcutsHelpOpen: false,

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    persistUI({ sidebarCollapsed: next });
  },

  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    persistUI({ sidebarCollapsed: collapsed });
  },

  setSyntaxHelpOpen: (open) => set({ syntaxHelpOpen: open }),

  setShortcutsHelpOpen: (open) => set({ shortcutsHelpOpen: open }),
  toggleShortcutsHelp: () =>
    set((s) => ({ shortcutsHelpOpen: !s.shortcutsHelpOpen })),
}));
