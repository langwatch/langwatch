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
  // Transient override used only on mobile (< md). The persisted
  // `sidebarCollapsed` is the user's desktop preference; on a narrow
  // viewport we force-collapse regardless, but the user can opt back
  // in for the rest of the session via this flag.
  mobileExpandedOverride: boolean;
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
  // Default to open — the filter sidebar is the primary discovery surface
  // for the table, and starting collapsed left first-time users (and
  // anyone who cleared localStorage) staring at a rail of icons. Users
  // who prefer the slim view can still collapse it, and that choice
  // persists.
  sidebarCollapsed: false,
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

// Chakra's default `md` breakpoint is 48em — match that here so the
// store and `useBreakpointValue({ base, md })` in FilterAside agree on
// where "mobile" ends.
function isBelowMdViewport(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 47.99em)").matches;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: initial.sidebarCollapsed,
  mobileExpandedOverride: false,
  syntaxHelpOpen: false,
  shortcutsHelpOpen: false,

  toggleSidebar: () => {
    // On mobile we don't touch the persisted desktop preference — the
    // user is just opting in/out for this session. Without this gate
    // the persisted flag would be set to `expanded` on a 390px viewport
    // and silently bleed into the next desktop session.
    if (isBelowMdViewport()) {
      set({ mobileExpandedOverride: !get().mobileExpandedOverride });
      return;
    }
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
