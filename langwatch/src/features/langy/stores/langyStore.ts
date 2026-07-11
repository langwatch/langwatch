import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Single client/UI-state store for the Langy panel (ADR-046 frontend).
 *
 * Everything the panel needs to *decide what to render* lives here — panel
 * visibility, which conversation is active, the composer draft + model
 * override, the dismissed page-context chips, the per-proposal apply/discard
 * lifecycle, the Stream-B optimistic token buffer, and the persisted developer
 * mode. SERVER state (the recents list, a conversation's message history) is
 * NOT here — that is React Query (`data/useLangyConversationList`,
 * `data/useLangyMessages`) keyed by conversation id, kept fresh by the
 * `useLangyFreshness` SSE coordinator. This store holds only the pointer
 * (`activeConversationId`) into that server state, never a copy of it.
 *
 * The store is a module singleton (survives the per-project panel remount that
 * `LangyProvider key={projectSlug}` forces), so conversation-scoped state is
 * reset explicitly on project change via `resetForProject`.
 */

/**
 * A removable page-context chip that rides INSIDE the composer surface (e.g.
 * "Experiment: my-slug", "Trace: abc123", "Project: web-app"). Page context is
 * derived from the current route / LangyContext (see `useLangyPageContext`);
 * this store only tracks which chips the user dismissed, so a dismissed chip
 * stays gone until its underlying context changes (a new id re-surfaces it) or
 * the user adds it back.
 */
export interface LangyContextChip {
  /** Stable id, e.g. `experiment:my-slug`. Dismissal is keyed on this. */
  id: string;
  kind:
    | "project"
    | "experiment"
    | "trace"
    | "prompt"
    | "dataset"
    | "dashboard"
    | "scenario";
  label: string;
  /**
   * The resource ref (id / slug) this chip stands for, forwarded to the agent
   * as turn context. Absent for the project chip (the project is implicit).
   */
  ref?: string;
}

/** The "Open in <surface>" affordance a page-scoped proposal handler returns. */
export interface LangyAppliedOutcome {
  href?: string;
  label?: string;
  onOpen?: () => void;
}

interface LangyState {
  // Panel visibility
  isOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Active conversation (a pointer into React Query server state)
  activeConversationId: string | null;
  /**
   * The conversation whose durable server history should hydrate the chat
   * engine. Set only when the USER selects a conversation; cleared once the
   * panel has applied it. Deliberately NOT set on `adoptConversation`: a turn
   * that just created a conversation already holds its live messages in the
   * chat engine, so re-hydrating from the (possibly lagging) server projection
   * would clobber the in-flight stream.
   */
  historyLoadConversationId: string | null;
  /** User picked a conversation from recents — load its history. */
  selectConversation: (id: string) => void;
  /**
   * The server created/confirmed a conversation for the live turn — point at
   * it WITHOUT reloading history (the stream already holds the messages).
   */
  adoptConversation: (id: string) => void;
  /** Start a fresh, empty conversation. */
  startNewConversation: () => void;
  /** Mark the pending history load as applied. */
  consumeHistoryLoad: () => void;

  // Composer
  draft: string;
  setDraft: (draft: string) => void;
  /** Per-session model override for the next send. "" = use the project default. */
  modelOverride: string;
  setModelOverride: (model: string) => void;

  // Page-context chips (dismissed set)
  dismissedChipIds: Set<string>;
  dismissChip: (id: string) => void;
  /** Undo a dismissal — the composer's "+ context" add control. */
  restoreChip: (id: string) => void;
  resetDismissedChips: () => void;

  // Proposal lifecycle (keyed by proposal id)
  appliedOutcomes: Record<string, LangyAppliedOutcome>;
  discardedProposalIds: Set<string>;
  applyingProposalIds: Set<string>;
  markProposalApplying: (id: string) => void;
  markProposalApplied: (id: string, outcome: LangyAppliedOutcome) => void;
  clearProposalApplying: (id: string) => void;
  discardProposal: (id: string) => void;

  // Stream B (raw-token fast path, ADR-048)
  activeTurnId: string | null;
  setActiveTurnId: (id: string | null) => void;
  /** Accumulated optimistic answer text for the in-flight turn. */
  optimisticText: string;
  setOptimisticText: (text: string) => void;

  // Developer mode (persisted per browser)
  devMode: boolean;
  setDevMode: (devMode: boolean) => void;

  // Resets
  /** Wipe per-conversation transient state (proposals + optimistic + turn). */
  resetActiveConversationState: () => void;
  /** Full reset when the active project changes (the store is a singleton). */
  resetForProject: () => void;
}

const emptyConversationState = () => ({
  appliedOutcomes: {} as Record<string, LangyAppliedOutcome>,
  discardedProposalIds: new Set<string>(),
  applyingProposalIds: new Set<string>(),
  activeTurnId: null as string | null,
  optimisticText: "",
});

export const useLangyStore = create<LangyState>()(
  persist(
    (set) => ({
      isOpen: false,
      openPanel: () => set({ isOpen: true }),
      closePanel: () => set({ isOpen: false }),
      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      activeConversationId: null,
      historyLoadConversationId: null,
      selectConversation: (id) =>
        set({
          activeConversationId: id,
          historyLoadConversationId: id,
          ...emptyConversationState(),
        }),
      adoptConversation: (id) => set({ activeConversationId: id }),
      startNewConversation: () =>
        set({
          activeConversationId: null,
          historyLoadConversationId: null,
          dismissedChipIds: new Set<string>(),
          ...emptyConversationState(),
        }),
      consumeHistoryLoad: () => set({ historyLoadConversationId: null }),

      draft: "",
      setDraft: (draft) => set({ draft }),
      modelOverride: "",
      setModelOverride: (modelOverride) => set({ modelOverride }),

      dismissedChipIds: new Set<string>(),
      dismissChip: (id) =>
        set((state) => {
          const next = new Set(state.dismissedChipIds);
          next.add(id);
          return { dismissedChipIds: next };
        }),
      restoreChip: (id) =>
        set((state) => {
          if (!state.dismissedChipIds.has(id)) return state;
          const next = new Set(state.dismissedChipIds);
          next.delete(id);
          return { dismissedChipIds: next };
        }),
      resetDismissedChips: () => set({ dismissedChipIds: new Set<string>() }),

      appliedOutcomes: {},
      discardedProposalIds: new Set<string>(),
      applyingProposalIds: new Set<string>(),
      markProposalApplying: (id) =>
        set((state) => {
          const next = new Set(state.applyingProposalIds);
          next.add(id);
          return { applyingProposalIds: next };
        }),
      markProposalApplied: (id, outcome) =>
        set((state) => ({
          appliedOutcomes: { ...state.appliedOutcomes, [id]: outcome },
        })),
      clearProposalApplying: (id) =>
        set((state) => {
          if (!state.applyingProposalIds.has(id)) return state;
          const next = new Set(state.applyingProposalIds);
          next.delete(id);
          return { applyingProposalIds: next };
        }),
      discardProposal: (id) =>
        set((state) => {
          const next = new Set(state.discardedProposalIds);
          next.add(id);
          return { discardedProposalIds: next };
        }),

      activeTurnId: null,
      setActiveTurnId: (activeTurnId) => set({ activeTurnId }),
      optimisticText: "",
      setOptimisticText: (optimisticText) => set({ optimisticText }),

      devMode: false,
      setDevMode: (devMode) => set({ devMode }),

      resetActiveConversationState: () => set(emptyConversationState()),
      resetForProject: () =>
        set({
          activeConversationId: null,
          historyLoadConversationId: null,
          draft: "",
          dismissedChipIds: new Set<string>(),
          ...emptyConversationState(),
        }),
    }),
    {
      name: "langy:store",
      // Only developer mode is durable; everything else is per-session client
      // state that must start clean (the panel opens empty by default).
      partialize: (state) => ({ devMode: state.devMode }),
    },
  ),
);

/** Filter a candidate chip list down to the ones the user hasn't dismissed. */
export function selectVisibleChips(
  candidates: LangyContextChip[],
  dismissed: Set<string>,
): LangyContextChip[] {
  return candidates.filter((chip) => !dismissed.has(chip.id));
}

/** The dismissed subset of a candidate list — the "+ context" add menu. */
export function selectDismissedChips(
  candidates: LangyContextChip[],
  dismissed: Set<string>,
): LangyContextChip[] {
  return candidates.filter((chip) => dismissed.has(chip.id));
}
