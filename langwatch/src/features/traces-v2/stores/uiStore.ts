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
  // User-set sidebar width in px. `null` means "use the auto-computed
  // default" (220px base + per-OR-group lanes). When the user drags the
  // resize handle, this becomes a number and overrides the default.
  sidebarWidth: number | null;
  // Transient override used only on mobile (< md). The persisted
  // `sidebarCollapsed` is the user's desktop preference; on a narrow
  // viewport we force-collapse regardless, but the user can opt back
  // in for the rest of the session via this flag.
  mobileExpandedOverride: boolean;
  syntaxHelpOpen: boolean;
  shortcutsHelpOpen: boolean;
  /**
   * Whether the FacetManagerPopover is open. Hoisted here so the
   * sidebar's icon trigger AND the floating "Configure" CTA in the
   * trace list area can both drive the same popover without each
   * keeping its own copy of the state. Both surfaces watch this
   * field; only one popover is mounted (in the sidebar).
   */
  facetManagerOpen: boolean;
  /**
   * Set on the user's first interaction with the floating Configure
   * button — either clicking it OR scrolling far enough to surface it.
   * Once set, the bottom-anchored CTA stops running its one-time
   * activation animation. Persisted to `localStorage`.
   */
  hasSeenConfigureCta: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarWidth: (width: number | null) => void;
  /**
   * Persist the current `sidebarCollapsed` + `sidebarWidth` snapshot to
   * `localStorage`. Pair with `setSidebarWidth` (which intentionally
   * stays in-memory only during a drag) — call this once on drag-end
   * so the user's chosen width survives a reload.
   */
  persistSidebarLayout: () => void;
  setSyntaxHelpOpen: (open: boolean) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  toggleShortcutsHelp: () => void;
  setFacetManagerOpen: (open: boolean) => void;
  /** Marks the activation animation as seen + persists to localStorage. */
  markConfigureCtaSeen: () => void;
}

const STORAGE_KEY = "langwatch:traces-v2:ui";
type Persisted = Pick<UIState, "sidebarCollapsed" | "sidebarWidth">;

const DEFAULT_PERSISTED: Persisted = {
  // Default to open — the filter sidebar is the primary discovery surface
  // for the table, and starting collapsed left first-time users (and
  // anyone who cleared localStorage) staring at a rail of icons. Users
  // who prefer the slim view can still collapse it, and that choice
  // persists.
  sidebarCollapsed: false,
  sidebarWidth: null,
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
      sidebarWidth:
        typeof parsed.sidebarWidth === "number" && parsed.sidebarWidth > 0
          ? parsed.sidebarWidth
          : DEFAULT_PERSISTED.sidebarWidth,
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

const CONFIGURE_CTA_SEEN_KEY = "langwatch:traces-v2:ui:configureCtaSeen";

function loadConfigureCtaSeen(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(CONFIGURE_CTA_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function persistConfigureCtaSeen(seen: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (seen) localStorage.setItem(CONFIGURE_CTA_SEEN_KEY, "1");
    else localStorage.removeItem(CONFIGURE_CTA_SEEN_KEY);
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
  sidebarWidth: initial.sidebarWidth,
  mobileExpandedOverride: false,
  syntaxHelpOpen: false,
  shortcutsHelpOpen: false,
  facetManagerOpen: false,
  hasSeenConfigureCta: loadConfigureCtaSeen(),

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
    persistUI({ sidebarCollapsed: next, sidebarWidth: get().sidebarWidth });
  },

  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    persistUI({ sidebarCollapsed: collapsed, sidebarWidth: get().sidebarWidth });
  },

  setSidebarWidth: (width) => {
    // Stays in-memory only — `localStorage.setItem` is synchronous and
    // running it on every pointer-move frame of a drag noticeably
    // jitters the resize. Persistence happens once at drag-end via
    // `persistSidebarLayout`, called from the resize handle.
    set({ sidebarWidth: width });
  },

  persistSidebarLayout: () => {
    const { sidebarCollapsed, sidebarWidth } = get();
    persistUI({ sidebarCollapsed, sidebarWidth });
  },

  setSyntaxHelpOpen: (open) => set({ syntaxHelpOpen: open }),

  setShortcutsHelpOpen: (open) => set({ shortcutsHelpOpen: open }),
  toggleShortcutsHelp: () =>
    set((s) => ({ shortcutsHelpOpen: !s.shortcutsHelpOpen })),

  setFacetManagerOpen: (open) => set({ facetManagerOpen: open }),

  markConfigureCtaSeen: () => {
    if (get().hasSeenConfigureCta) return;
    set({ hasSeenConfigureCta: true });
    persistConfigureCtaSeen(true);
  },
}));
