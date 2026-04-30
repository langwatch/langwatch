import { create } from "zustand";

interface UIState {
  sidebarCollapsed: boolean;
  syntaxHelpOpen: boolean;
  shortcutsHelpOpen: boolean;
  /**
   * Per-project persistent dismissal of the empty-state onboarding
   * card. Keyed on `projectId` so dismissing the card on Project A
   * doesn't hide it on Project B. Persisted to localStorage so a
   * reload (or a different tab on the same browser/profile) honours
   * the dismissal — that's the user signal "I've left this card,
   * stop showing me the dimmed-chrome onboarding view." Cleared by
   * the toolbar's "Continue integration" button when the user wants
   * to come back.
   */
  setupDismissedByProject: Record<string, boolean>;
  /**
   * "User has committed to leaving the empty-state card" — flipped
   * true the moment they click any exit action (Load sample data /
   * Skip / Learn about tracing) so the chrome dim lifts immediately,
   * even when the card itself is still finishing its post-send
   * countdown animation. In-memory only; reset whenever the card is
   * re-opened via the toolbar's Continue integration.
   */
  setupDisengaged: boolean;
  /**
   * Forces the empty-state journey + sample-data preview to show,
   * regardless of `firstMessage` on the project. Used by the toolbar's
   * "Tour" button so existing customers (firstMessage=true, real data
   * in the table) can opt back into the demo experience on demand.
   * In-memory only — closing the tab clears it; "Done exploring" or
   * any dismiss path also clears it so we don't sticky-trap real users
   * in the demo.
   */
  tourActive: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSyntaxHelpOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  toggleShortcutsHelp: () => void;
  setSetupDismissedForProject: (projectId: string, dismissed: boolean) => void;
  setSetupDisengaged: (disengaged: boolean) => void;
  setTourActive: (active: boolean) => void;
}

const STORAGE_KEY = "langwatch:traces-v2:ui";
type Persisted = Pick<
  UIState,
  "sidebarCollapsed" | "setupDismissedByProject"
>;

const DEFAULT_PERSISTED: Persisted = {
  sidebarCollapsed: true,
  setupDismissedByProject: {},
};

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
      setupDismissedByProject:
        parsed.setupDismissedByProject &&
        typeof parsed.setupDismissedByProject === "object"
          ? parsed.setupDismissedByProject
          : DEFAULT_PERSISTED.setupDismissedByProject,
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
  setupDismissedByProject: initial.setupDismissedByProject,
  setupDisengaged: false,
  tourActive: false,

  toggleSidebar: () => {
    const next = !get().sidebarCollapsed;
    set({ sidebarCollapsed: next });
    persistUI({
      sidebarCollapsed: next,
      setupDismissedByProject: get().setupDismissedByProject,
    });
  },

  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    persistUI({
      sidebarCollapsed: collapsed,
      setupDismissedByProject: get().setupDismissedByProject,
    });
  },

  setSyntaxHelpOpen: (open) => set({ syntaxHelpOpen: open }),

  setShortcutsHelpOpen: (open) => set({ shortcutsHelpOpen: open }),
  toggleShortcutsHelp: () =>
    set((s) => ({ shortcutsHelpOpen: !s.shortcutsHelpOpen })),

  // Toggling dismissal for a project. When un-dismissing (toolbar's
  // Continue integration), also re-arm engagement so the dim returns
  // the next time the card renders.
  setSetupDismissedForProject: (projectId, dismissed) => {
    const next = { ...get().setupDismissedByProject };
    if (dismissed) {
      next[projectId] = true;
    } else {
      delete next[projectId];
    }
    set({
      setupDismissedByProject: next,
      ...(dismissed ? {} : { setupDisengaged: false }),
    });
    persistUI({
      sidebarCollapsed: get().sidebarCollapsed,
      setupDismissedByProject: next,
    });
  },

  setSetupDisengaged: (disengaged) => set({ setupDisengaged: disengaged }),
  setTourActive: (active) => set({ tourActive: active }),
}));
