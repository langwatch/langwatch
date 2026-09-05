import {
  applyLangyTurnEvents,
  initialLangyTurnProjection,
  initialTurnPhaseState,
  isLangyTurnProjectionTerminal,
  type LangyConversationTurnWireEvent,
  type LangyEventCursor,
  type LangyTurnProjectionState,
  abandonStop as reduceAbandonStop,
  beginTurn as reduceBeginTurn,
  observeBackendTurn as reduceObserveBackendTurn,
  requestStop as reduceRequestStop,
  settleTurn as reduceSettleTurn,
  seedLangyTurnProjection,
  type TurnPhaseState,
} from "@langwatch/langy-contract";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LangyResourceKind } from "@langwatch/langy-contract";
import type { LangyProgressSample } from "../model/values/langy-turn";

/**
 * Single client/UI-state store for the Langy panel (ADR-046 frontend).
 */

/**
 * Who and where the panel's state belongs to.
 */
export interface LangyScope {
  userId: string | null;
  organizationId: string | null;
  projectId: string | null;
}

const UNKNOWN_SCOPE: LangyScope = {
  userId: null,
  organizationId: null,
  projectId: null,
};

/**
 * Fill in what a caller knows over what the store already knows.
 */
function mergeScope(current: LangyScope | null, update: Partial<LangyScope>): LangyScope {
  return { ...(current ?? UNKNOWN_SCOPE), ...update };
}

function isSameScope(a: LangyScope | null, b: LangyScope | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.userId === b.userId && a.organizationId === b.organizationId && a.projectId === b.projectId
  );
}

/**
 * A removable page-context chip that rides INSIDE the composer surface (e.g.
 * "Experiment: my-slug", "Trace: abc123", "Project: web-app").
 */
export interface LangyContextChip {
  /** Stable id, e.g. `experiment:my-slug`. Selection is keyed on this. */
  id: string;
  kind: LangyResourceKind;
  label: string;
  /**
   * The resource ref (id / slug) this chip stands for, forwarded to the agent
   * as turn context. Absent for the project chip (the project is implicit).
   */
  ref?: string;
}

/**
 * A capability the user has explicitly asked Langy to use on the next turn.
 */
export interface LangySkillChip {
  /** Feature-map feature id, or agent skill name. See ~/shared/langy/langy-skills.ts. */
  id: string;
  label: string;
  targetChipId: string | null;
}

/** The "Open in <surface>" affordance a page-scoped proposal handler returns. */
export interface LangyAppliedOutcome {
  href?: string;
  label?: string;
  onOpen?: () => void;
}

/**
 * A piece of context a SURFACE explicitly hands to Langy — the home briefing's "look at
 * this receipt", a card's "work from this", anything off the current route.
 */
export type LangyAttachedContextType = LangyContextChip["kind"];

export interface LangyAttachedContext {
  type: LangyAttachedContextType;
  /** Resource ref/id — forwarded to the agent as the chip's `ref`. */
  id: string;
  /** Human-friendly name shown in the sidebar. */
  label: string;
  /** Optional display/agent extras, e.g. `{ value: "8.2s", severity: "error" }`. */
  meta?: Record<string, unknown>;
}

/**
 * How the panel is laid out (Notion-style). `floating` = a rounded card that overlays
 * the page (and floats above a drawer); `sidebar` = a full-height right dock that
 * pushes page content left (a drawer nests to its left). User-picked, persisted.
 */
export type LangyPanelMode = "floating" | "sidebar";

/**
 * Which decorative treatment the panel wears — an interim design-comparison switch (see
 * LangyWave). `fold` is the two-tone brand fold whose seam moves with Langy's own
 * activity (never the cursor); `plain` is no effect, just the themed surface.
 */
export type LangyPanelEffect = "fold" | "plain";

/**
 * One measured batch-progress observation from the worker.
 */
interface LangyState extends TurnPhaseState {
  // Panel visibility.
  // Spec: specs/langy/langy-peek-dock.feature
  isOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  // Command-bar → panel handoff: a question queued from the Cmd+K "Ask Langy"
  // activation, auto-sent by the panel once it is mounted and idle. Ephemeral
  // (never persisted) — it exists only for the hop between the bar and the panel.
  pendingPrompt: string | null;
  /** Open Langy on a fresh conversation and queue `prompt` to auto-send. */
  askLangy: (prompt: string) => void;
  /** The panel has taken the queued prompt — clear it so it fires once. */
  consumePendingPrompt: () => void;

  /**
   * The panel's composer is asked to take focus.
   */
  composerFocusRequested: boolean;
  /** Ask the composer to take focus. */
  requestComposerFocus: () => void;
  /** The composer has taken the requested focus — clear it so it fires once. */
  consumeComposerFocus: () => void;

  // Layout mode (Floating / Sidebar) — user-picked, persisted
  panelMode: LangyPanelMode;
  setPanelMode: (mode: LangyPanelMode) => void;

  // Floating-panel decorative treatment (Fold / Split / Plain) — persisted
  panelEffect: LangyPanelEffect;
  setPanelEffect: (effect: LangyPanelEffect) => void;

  /**
   * How many mounted app shells have claimed the docked panel's placement.
   */
  dockShellClaims: number;
  claimDockShell: () => void;
  releaseDockShell: () => void;

  /**
   * The docked panel is open and reserving room right now, the one truth the page
   * wrapper computes (visibility gate + open + sidebar mode, see LangyShiftedRoot) and
   * the app shell consumes to reserve the dock's room inside its content row.
   */
  dockShifted: boolean;
  setDockShifted: (shifted: boolean) => void;

  /**
   * The home page's ask field is in use right now.
   */
  homeAskOpen: boolean;
  setHomeAskOpen: (open: boolean) => void;

  /**
   * What the page Langy is driving is doing this second, in the page's own words, or
   * null when it is doing nothing.
   */
  pageActivity: string | null;
  setPageActivity: (activity: string | null) => void;

  // Active conversation (a pointer into React Query server state)
  activeConversationId: string | null;
  /**
   * The conversation id a panel-open warm minted ahead of the first message
   * (specs/langy/langy-worker-prewarm.feature).
   */
  pendingConversationId: string | null;
  /** The warm hook stores the id its mutation returned; null clears it. */
  setPendingConversationId: (id: string | null) => void;
  /**
   * The conversation whose worker the last warm PROVED alive (`warmed: true` from
   * `langy.warmWorker`).
   */
  warmedConversationId: string | null;
  /** A warm answered `warmed: true` for this conversation's worker. */
  markConversationWarmed: (id: string) => void;
  /**
   * The conversation whose durable server history should hydrate the chat engine. Set
   * only when the USER selects a conversation; cleared once the panel has applied it.
   */
  historyLoadConversationId: string | null;
  /** User picked a conversation from recents — load its history. */
  selectConversation: (id: string) => void;
  /**
   * The server created/confirmed a conversation for the live turn — point at
   * it WITHOUT reloading history (the stream already holds the messages).
   */
  adoptConversation: (id: string) => void;
  /**
   * Conversations THIS tab created whose read-side projection has not yet been seen.
   */
  unconfirmedConversations: Record<string, true>;
  /** A durable read or signal proved the conversation's projection exists. */
  confirmConversation: (id: string) => void;
  /** Start a fresh, empty conversation. */
  startNewConversation: () => void;
  /** Mark the pending history load as applied. */
  consumeHistoryLoad: () => void;

  // Composer
  draft: string;
  setDraft: (draft: string) => void;
  /** Per-session model override for the next send. "" = use the project default. */
  modelOverride: string;
  /**
   * Seeding: the panel writing the resolved default, or an allowlist snap. Either way
   * the model is not the user's choice, so this clears the pick flag.
   */
  setModelOverride: (model: string) => void;
  /** The user choosing a model in the picker. Their pick, not a seed. */
  pickModel: (model: string) => void;
  /**
   * Whether the model in the picker is the user's own choice rather than a seeded
   * value. Session-only, never persisted, and cleared with the conversation it was made
   * in.
   */
  isModelPickedByUser: boolean;
  /**
   * Which conversation the picker was last seeded for from the durable
   * record — so a poll of the same history does not re-apply a model the
   * user has since picked away from. Session-only, never persisted.
   */
  modelSeededForConversationId: string | null;
  /**
   * A conversation remembers the model its last turn ran on; opening it
   * brings that model back to the picker. Applies once per selection, and
   * never over the user's own pick.
   */
  followConversationModel: (args: { conversationId: string; model: string }) => void;
  /**
   * The project's coding default changed server-side (a codex connect flow wrote the
   * LANGY role default).
   */
  followCodingDefaultChange: (change: { nextDefault: string }) => void;

  /**
   * Page-context chips the user has CHOSEN, by id.
   */
  chosenChipIds: Set<string>;
  /** Take a candidate chip into context. */
  chooseChip: (id: string) => void;
  /** Drop a chosen chip — the chip's own ✕. */
  dismissChip: (id: string) => void;
  resetChosenChips: () => void;

  /**
   * Context handed to Langy by a SURFACE (a home card, a briefing receipt, any "attach
   * this" affordance). The clean, typed entry point every surface uses; read
   * `attachedContext` to LIST it.
   */
  attachedContext: LangyAttachedContext[];
  attachContext: (item: LangyAttachedContext) => void;
  detachContext: (id: string) => void;
  clearAttachedContext: () => void;

  /**
   * Skill chips the user has attached to the next turn.
   */
  skillChips: LangySkillChip[];
  addSkillChip: (skill: { id: string; label: string }) => void;
  removeSkillChip: (id: string) => void;
  /** Bind a skill to one of the turn's resource chips, or clear the binding. */
  setSkillTarget: (skillId: string, targetChipId: string | null) => void;
  clearSkillChips: () => void;

  // Proposal lifecycle (keyed by proposal id)
  appliedOutcomes: Record<string, LangyAppliedOutcome>;
  discardedProposalIds: Set<string>;
  applyingProposalIds: Set<string>;
  markProposalApplying: (id: string) => void;
  markProposalApplied: (id: string, outcome: LangyAppliedOutcome) => void;
  clearProposalApplying: (id: string) => void;
  discardProposal: (id: string) => void;

  // Feedback cards the user waved away, keyed by the assistant message they sat
  // under. Conversation-scoped (see emptyConversationState) — a dismissal means
  // "not for this answer", not "never again"; the cross-session quiet period is
  // the backend's job (langy.messages `shouldAskFeedback` + langy.feedbackPromptShown).
  dismissedFeedbackMessageIds: Set<string>;
  dismissFeedback: (messageId: string) => void;
  /**
   * The assistant message whose feedback card must stay rendered regardless of the
   * server cadence flag.
   */
  pinnedFeedbackMessageId: string | null;
  pinFeedback: (messageId: string) => void;

  // The turn phase — the SINGLE, event-driven source for the composer's send/stop
  // affordance and every "is a turn in flight" read (ADR-078).
  beginTurn: (args: { conversationId: string; turnId: string }) => void;
  /** The user hit Stop: `active` → `stopping` (a no-op in any other phase). */
  requestStop: () => void;
  /**
   * The conversation whose last turn THIS browser stopped (ADR-078). What lets an empty
   * stopped reply read "Interrupted" instead of "No content".
   */
  interruptedConversationId: string | null;
  /**
   * The stop request never reached the backend: `stopping` → `active`. The
   * spinner is a promise that a stop is on its way, so it may not outlive a
   * request that failed to go out.
   */
  abandonStop: () => void;
  /**
   * Reconcile with the DURABLE fold — the tab-independent truth of whether a turn is in
   * flight.
   */
  observeBackendTurn: (inFlight: boolean) => void;
  /** A genuine end-of-turn frame settled the turn: go `idle` immediately. */
  settleTurn: (turnId: string | null) => void;
  /**
   * The LOCAL turn projection (ADR-059): the durable event tail folded through the same
   * reducer the server projection runs.
   */
  turnProjection: LangyTurnProjectionState;
  /**
   * Adopt a conversation snapshot's position (cursor + in-flight turn id). When the
   * snapshot names a turn in flight and this tab tracks none, the tab adopts it — which
   * is what makes Stop (and the live stream) work after a refresh.
   */
  seedTurnProjection: (snapshot: {
    cursor: LangyEventCursor | null;
    currentTurnId?: string | null;
  }) => void;
  /** Fold a fetched durable tail; idempotent under re-delivery and overlap. */
  applyTurnEvents: (events: readonly LangyConversationTurnWireEvent[]) => void;
  /** Latest coarse status line for the turn (e.g. "Searching traces…"). */
  turnStatus: string | null;
  /**
   * The current turnStatus is the manager's pre-first-frame readiness line ("Starting
   * Langy…", "Thinking…") — a placeholder for silence.
   */
  turnStatusIsReadiness: boolean;
  /** Latest progress fraction/percentage for the turn (0..1 or 0..100). */
  turnProgress: number | null;
  /** Latest measured X/Y sample used for smooth, rate-aware interpolation. */
  turnProgressSample: LangyProgressSample | null;
  /**
   * The model's reasoning (thinking) for the turn, accumulated from the live
   * `reasoning` stream. Ephemeral — never persisted, cleared when the turn ends
   * or a new one starts, so it only ever shows while a reply is streaming.
   */
  turnReasoning: string | null;
  /**
   * The manager's typed plan snapshot for the live turn (its whole todo list),
   * last-snapshot-wins.
   */
  turnPlan: Array<{ content: string; status: string }> | null;
  setTurnStatus: (status: string | null) => void;
  /** Set the manager's readiness placeholder status (see turnStatusIsReadiness). */
  setTurnReadinessStatus: (status: string | null) => void;
  setTurnProgress: (progress: number | null) => void;
  setTurnProgressSample: (sample: LangyProgressSample | null) => void;
  /** Append a run of streamed reasoning tokens to the live thinking. */
  appendTurnReasoning: (text: string) => void;
  /** Replace the live plan snapshot (whole list; last wins). */
  setTurnPlan: (items: Array<{ content: string; status: string }>) => void;
  /** Clear the live signals — called when a new turn starts. */
  resetTurnSignals: () => void;

  // Developer mode (persisted per browser)
  devMode: boolean;
  setDevMode: (devMode: boolean) => void;

  /**
   * Developer-mode card gallery: renders every card Langy can produce, with fixture
   * data, in place of the conversation. Deliberately NOT persisted — it is a debugging
   * lens you open, look through, and close, not a mode you leave a browser in.
   */
  cardGalleryOpen: boolean;
  toggleCardGallery: () => void;
  closeCardGallery: () => void;

  /**
   * The scope `activeConversationId` belongs to. Persisted alongside it so a
   * restored conversation can be proven to belong HERE — see `resetForScope`.
   */
  activeConversationScope: LangyScope | null;

  /**
   * True once `resetForScope` has run in THIS page load. Never persisted.
   */
  scopeAnnounced: boolean;

  /**
   * Bumped whenever the panel starts over: a new chat, an `askLangy` handoff, or a
   * scope change.
   */
  conversationEpoch: number;

  // Resets
  resetForScope: (scope: Partial<LangyScope>) => void;
  /** `resetForScope` for a caller that only knows the project. */
  resetForProject: (projectId: string) => void;
}

const emptyConversationState = () => ({
  // Skills steer ONE turn. Carrying "use GitHub" silently into the next
  // conversation would be the panel making decisions on the user's behalf.
  skillChips: [] as LangySkillChip[],
  appliedOutcomes: {} as Record<string, LangyAppliedOutcome>,
  discardedProposalIds: new Set<string>(),
  applyingProposalIds: new Set<string>(),
  dismissedFeedbackMessageIds: new Set<string>(),
  pinnedFeedbackMessageId: null as string | null,
  ...initialTurnPhaseState,
  turnProjection: initialLangyTurnProjection,
  turnStatus: null as string | null,
  turnStatusIsReadiness: false as boolean,
  turnProgress: null as number | null,
  turnProgressSample: null as LangyProgressSample | null,
  turnReasoning: null as string | null,
  turnPlan: null as Array<{ content: string; status: string }> | null,
  // A fresh conversation drops any question still queued for the previous one.
  pendingPrompt: null as string | null,
  // A conversation change also drops the id a panel-open warm minted: the
  // pending id belongs to the fresh chat the warm was fired for, and the warm
  // hook re-warms (and re-mints) for whatever the panel points at next.
  pendingConversationId: null as string | null,
});

/**
 * The ONLY state allowed to cross a change of user, organization or project.
 */
const SCOPE_INDEPENDENT_KEYS: ReadonlySet<string> = new Set<keyof LangyState>([
  "isOpen",
  "panelMode",
  "panelEffect",
  "devMode",
  "dockShellClaims",
  "dockShifted",
]);

/**
 * Every scoped field, back at its initial value.
 */
function scopedInitialState(): Partial<LangyState> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(useLangyStore.getInitialState())) {
    if (typeof value === "function") continue;
    if (SCOPE_INDEPENDENT_KEYS.has(key)) continue;
    patch[key] = freshCopy(value);
  }
  return patch as Partial<LangyState>;
}

function freshCopy(value: unknown): unknown {
  if (value instanceof Set) return new Set(value);
  if (value instanceof Map) return new Map(value);
  if (Array.isArray(value)) return [...value];
  if (value !== null && typeof value === "object") return { ...value };
  return value;
}

export const useLangyStore = create<LangyState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      openPanel: () => set({ isOpen: true }),
      closePanel: () => set({ isOpen: false }),

      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      pendingPrompt: null,
      askLangy: (prompt) =>
        set(() => ({
          isOpen: true,
          // A fresh ask starts a clean conversation, mirroring startNewConversation (the chat engine is reset
          // panel-side when the queued prompt is consumed) — with ONE deliberate difference: the context the
          // user just grabbed RIDES ALONG.
          activeConversationId: null,
          historyLoadConversationId: null,
          draft: "",
          // The model pick belongs to the conversation being left behind, the
          // same as a new chat. Kept, it would steer a conversation the user
          // never picked it for, and hold the pill off the default for good.
          modelOverride: "",
          isModelPickedByUser: false,
          modelSeededForConversationId: null,
          ...emptyConversationState(),
          // AFTER the spread: emptyConversationState() nulls `pendingPrompt`, so
          // the queued question is written last or it would be wiped out.
          pendingPrompt: prompt.trim() || null,
          // The reader expects to keep typing in the panel they just opened.
          composerFocusRequested: true,
        })),
      consumePendingPrompt: () => set({ pendingPrompt: null }),

      composerFocusRequested: false,
      requestComposerFocus: () => set({ composerFocusRequested: true }),
      consumeComposerFocus: () => set({ composerFocusRequested: false }),

      // Sidebar by default: docked inside the app shell as a second content
      // card, working alongside the page. Floating stays one toggle away in
      // the overflow menu (user-picked, persisted).
      panelMode: "sidebar",
      setPanelMode: (panelMode) => set({ panelMode }),
      // `fold` is the default: the two-tone brand fold IS the panel's design, and
      // shipping the undecorated surface as the default meant nobody saw it unless they
      // went looking in a menu. `plain` stays one toggle away.
      panelEffect: "fold",
      setPanelEffect: (panelEffect) => set({ panelEffect }),

      dockShellClaims: 0,
      claimDockShell: () => set((state) => ({ dockShellClaims: state.dockShellClaims + 1 })),
      releaseDockShell: () =>
        set((state) => ({
          dockShellClaims: Math.max(0, state.dockShellClaims - 1),
        })),

      dockShifted: false,
      setDockShifted: (dockShifted) => set({ dockShifted }),

      homeAskOpen: false,
      setHomeAskOpen: (homeAskOpen) => set({ homeAskOpen }),

      pageActivity: null,
      setPageActivity: (pageActivity) => set({ pageActivity }),

      activeConversationId: null,
      activeConversationScope: null,
      scopeAnnounced: false,
      conversationEpoch: 0,
      historyLoadConversationId: null,
      pendingConversationId: null,
      setPendingConversationId: (id) => set({ pendingConversationId: id }),
      warmedConversationId: null,
      markConversationWarmed: (id) => set({ warmedConversationId: id }),
      selectConversation: (id) =>
        set({
          activeConversationId: id,
          historyLoadConversationId: id,
          // The pick belongs to the conversation being left behind; the one
          // being opened seeds its own from the durable record (or the
          // default) once its history lands.
          modelOverride: "",
          isModelPickedByUser: false,
          modelSeededForConversationId: null,
          ...emptyConversationState(),
        }),
      // The pending id is retired either way: adopted (the send used it and it
      // just became the active id) or superseded (the server minted its own).
      adoptConversation: (id) => set({ activeConversationId: id, pendingConversationId: null }),
      startNewConversation: () =>
        set((state) => ({
          activeConversationId: null,
          historyLoadConversationId: null,
          // A new chat starts on a BLANK composer. Without this, the half-typed
          // text abandoned in the last conversation is still sitting there,
          // primed to be sent into the new one. (`resetForScope` already
          // cleared the draft — it was simply missed here.)
          draft: "",
          // A model pick lives with its conversation ("Just this
          // conversation" is the dialog's promise) — a new chat starts on
          // the resolved default again.
          modelOverride: "",
          isModelPickedByUser: false,
          modelSeededForConversationId: null,
          chosenChipIds: new Set<string>(),
          // The targets the user pointed at were gathered for the conversation
          // being left behind; the epoch is what tells the target store to let
          // them go (see its subscription).
          conversationEpoch: state.conversationEpoch + 1,
          ...emptyConversationState(),
          // A new chat exists to be written in, so it opens with the cursor
          // already in the composer.
          composerFocusRequested: true,
        })),
      consumeHistoryLoad: () => set({ historyLoadConversationId: null }),

      draft: "",
      setDraft: (draft) => set({ draft }),
      modelOverride: "",
      setModelOverride: (modelOverride) => set({ modelOverride, isModelPickedByUser: false }),
      pickModel: (modelOverride) => set({ modelOverride, isModelPickedByUser: true }),
      isModelPickedByUser: false,
      modelSeededForConversationId: null,
      followConversationModel: ({ conversationId, model }) =>
        set((state) => {
          if (state.activeConversationId !== conversationId) return state;
          if (state.modelSeededForConversationId === conversationId) return state;
          return state.isModelPickedByUser
            ? { modelSeededForConversationId: conversationId }
            : {
                modelOverride: model,
                modelSeededForConversationId: conversationId,
              };
        }),
      followCodingDefaultChange: ({ nextDefault }) =>
        set((state) => (state.isModelPickedByUser ? state : { modelOverride: nextDefault })),

      chosenChipIds: new Set<string>(),
      chooseChip: (id) =>
        set((state) => {
          if (state.chosenChipIds.has(id)) return state;
          const next = new Set(state.chosenChipIds);
          next.add(id);
          return { chosenChipIds: next };
        }),
      dismissChip: (id) =>
        set((state) => {
          if (!state.chosenChipIds.has(id)) return state;
          const next = new Set(state.chosenChipIds);
          next.delete(id);
          return { chosenChipIds: next };
        }),
      resetChosenChips: () => set({ chosenChipIds: new Set<string>() }),

      attachedContext: [],
      attachContext: (item) =>
        set((state) => {
          const existingIndex = state.attachedContext.findIndex(
            (attached) => attached.id === item.id,
          );
          // Re-attaching an id is a refresh, not a duplicate: replace in place so
          // a label/meta that changed (a title subscriber landed) updates without
          // stacking a second chip or losing the item's position.
          if (existingIndex >= 0) {
            const next = [...state.attachedContext];
            next[existingIndex] = item;
            return { attachedContext: next };
          }
          return { attachedContext: [...state.attachedContext, item] };
        }),
      detachContext: (id) =>
        set((state) => {
          if (!state.attachedContext.some((item) => item.id === id)) {
            return state;
          }
          return {
            attachedContext: state.attachedContext.filter((item) => item.id !== id),
          };
        }),
      clearAttachedContext: () =>
        set((state) => (state.attachedContext.length === 0 ? state : { attachedContext: [] })),

      skillChips: [],
      addSkillChip: (skill) =>
        set((state) => {
          // Idempotent: summoning the same skill twice is a no-op, not a
          // duplicate chip. `/gh` then `/github` is one intent.
          if (state.skillChips.some((chip) => chip.id === skill.id)) {
            return state;
          }
          return {
            skillChips: [
              ...state.skillChips,
              { id: skill.id, label: skill.label, targetChipId: null },
            ],
          };
        }),
      removeSkillChip: (id) =>
        set((state) => ({
          skillChips: state.skillChips.filter((chip) => chip.id !== id),
        })),
      setSkillTarget: (skillId, targetChipId) =>
        set((state) => ({
          skillChips: state.skillChips.map((chip) =>
            chip.id === skillId ? { ...chip, targetChipId } : chip,
          ),
        })),
      clearSkillChips: () => set({ skillChips: [] }),

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

      dismissedFeedbackMessageIds: new Set<string>(),
      dismissFeedback: (messageId) =>
        set((state) => {
          const next = new Set(state.dismissedFeedbackMessageIds);
          next.add(messageId);
          return { dismissedFeedbackMessageIds: next };
        }),
      pinnedFeedbackMessageId: null,
      // Pinning un-dismisses: `/feedback` after waving the card away must
      // re-open it, and the dismissal check would otherwise win forever.
      pinFeedback: (messageId) =>
        set((state) => {
          const dismissed = new Set(state.dismissedFeedbackMessageIds);
          dismissed.delete(messageId);
          return {
            pinnedFeedbackMessageId: messageId,
            dismissedFeedbackMessageIds: dismissed,
          };
        }),

      // The turn phase machine (@langwatch/langy turnPhase.ts) — pure transitions wired in a
      // few lines. Every phase change goes through these four events.
      ...initialTurnPhaseState,
      beginTurn: ({ conversationId, turnId }) =>
        set((s) => ({
          ...reduceBeginTurn(s, turnId),
          // The phase transition adopts the turn; the store rides alongside it,
          // adopting the conversation and clearing the previous turn's live
          // signals (status / progress / reasoning / plan).
          activeConversationId: conversationId,
          // A conversation this dispatch just MINTED (the tab pointed at
          // nothing, or at another conversation) starts unconfirmed: its
          // projection may lag the accepted command, and a not-found read in
          // that window must present as pending, not as an error.
          unconfirmedConversations:
            s.activeConversationId === conversationId
              ? s.unconfirmedConversations
              : { ...s.unconfirmedConversations, [conversationId]: true },
          turnStatus: null,
          turnStatusIsReadiness: false,
          turnProgress: null,
          turnProgressSample: null,
          turnReasoning: null,
          turnPlan: null,
          interruptedConversationId: null,
          // The warmed id is spent: this turn either adopted it or the server
          // minted its own. Keeping it would let the NEXT new chat send its
          // first message into this conversation, because the create path
          // reads the pending id whenever no conversation is active.
          pendingConversationId: null,
        })),
      unconfirmedConversations: {},
      confirmConversation: (id) =>
        set((s) => {
          if (!s.unconfirmedConversations[id]) return s;
          const { [id]: _confirmed, ...rest } = s.unconfirmedConversations;
          return { unconfirmedConversations: rest };
        }),
      interruptedConversationId: null,
      requestStop: () =>
        set((s) => ({
          ...reduceRequestStop(s),
          // Only a stop that actually moved the machine counts as an
          // interruption — requestStop is a no-op outside `active`.
          interruptedConversationId:
            s.turnPhase === "active" ? s.activeConversationId : s.interruptedConversationId,
        })),
      abandonStop: () =>
        set((s) => ({
          ...reduceAbandonStop(s),
          // The stop never went out, so nothing was interrupted.
          interruptedConversationId: null,
        })),
      observeBackendTurn: (inFlight) => set((s) => reduceObserveBackendTurn(s, inFlight)),
      settleTurn: (turnId) => set((s) => reduceSettleTurn(s, turnId)),

      // The local turn projection (ADR-059) — pure reducers from
      // @langwatch/langy, composed with the phase machine in the two places
      // durable truth arrives: the snapshot seed and the folded tail.
      turnProjection: initialLangyTurnProjection,
      seedTurnProjection: (snapshot) =>
        set((s) => {
          const turnProjection = seedLangyTurnProjection(s.turnProjection, snapshot);
          // Refresh-resume: the durable record names a turn in flight and this tab
          // tracks none — adopt it so Stop targets it and live signals route to it.
          const adoptTurnId =
            snapshot.currentTurnId && s.activeTurnId === null && turnProjection !== s.turnProjection
              ? snapshot.currentTurnId
              : null;
          // The phase reducers return the WHOLE state (`{...state, ...}`), so
          // the fresh projection must be spread AFTER them or the old one
          // rides back in — same override-after-spread shape as beginTurn.
          return {
            ...(adoptTurnId
              ? {
                  ...reduceObserveBackendTurn(s, true),
                  activeTurnId: adoptTurnId,
                }
              : {}),
            turnProjection,
          };
        }),
      applyTurnEvents: (events) =>
        set((s) => {
          const turnProjection = applyLangyTurnEvents(s.turnProjection, events);
          if (turnProjection === s.turnProjection) return {};
          if (isLangyTurnProjectionTerminal(turnProjection)) {
            // The recorded terminal settles the machine — same effect as the
            // stream's end frame, but driven by the durable record, so it
            // lands even when this tab never had the stream.
            return {
              ...reduceSettleTurn(s, turnProjection.turnId),
              turnProjection,
            };
          }
          if (turnProjection.turn?.Status === "running") {
            // The settle marker exists to gag the fold RE-ASSERTING the turn whose end
            // frame already landed (its projection lags).
            const base =
              s.settledTurnId !== null && turnProjection.turnId !== s.settledTurnId
                ? {
                    ...s,
                    settledTurnId: null,
                    activeTurnId: s.activeTurnId === s.settledTurnId ? null : s.activeTurnId,
                  }
                : s;
            return {
              ...reduceObserveBackendTurn(base, true),
              // Adopt a running turn this tab doesn't track (another tab's
              // send, a re-driven turn) so Stop and live signals target it.
              activeTurnId: base.activeTurnId ?? turnProjection.turnId,
              turnProjection,
            };
          }
          return { turnProjection };
        }),
      turnStatus: null,
      turnStatusIsReadiness: false,
      turnProgress: null,
      turnProgressSample: null,
      turnReasoning: null,
      turnPlan: null,
      setTurnStatus: (turnStatus) => set({ turnStatus, turnStatusIsReadiness: false }),
      setTurnReadinessStatus: (turnStatus) => set({ turnStatus, turnStatusIsReadiness: true }),
      setTurnProgress: (turnProgress) => set({ turnProgress }),
      setTurnProgressSample: (turnProgressSample) => set({ turnProgressSample }),
      appendTurnReasoning: (text) =>
        set((s) => ({ turnReasoning: (s.turnReasoning ?? "") + text })),
      setTurnPlan: (turnPlan) => set({ turnPlan }),
      resetTurnSignals: () =>
        set({
          turnStatus: null,
          turnStatusIsReadiness: false,
          turnProgress: null,
          turnProgressSample: null,
          turnReasoning: null,
          turnPlan: null,
        }),

      devMode: false,
      // Leaving dev mode takes the gallery with it — otherwise a user who
      // toggles dev mode off is left staring at a wall of fixtures.
      setDevMode: (devMode) => set(devMode ? { devMode } : { devMode, cardGalleryOpen: false }),

      cardGalleryOpen: false,
      toggleCardGallery: () => set((state) => ({ cardGalleryOpen: !state.cardGalleryOpen })),
      closeCardGallery: () => set({ cardGalleryOpen: false }),

      /**
       * Called when the panel enters a scope — a user, an organization, a project.
       */
      resetForScope: (scope) =>
        set((state) => {
          const current = state.activeConversationScope;
          const merged = mergeScope(current, scope);
          const unchanged = !!current && isSameScope(current, merged);
          // A re-announcement of the scope we are already in is a heartbeat, not a move
          // — the org/project hook re-fires on every refetch (window focus included)
          // with the same three ids.
          if (unchanged && state.scopeAnnounced) return state;
          // Keep the SAME object when nothing moved. Two callers announce the
          // scope — the layout, which knows all three ids, and the panel, which
          // knows the project — and the sibling stores follow this reference.
          // Handing them a fresh-but-equal object would empty the target
          // registry out from under the rows that had just registered in it.
          return {
            ...scopedInitialState(),
            // AFTER the spread: the sweep resets it, announcing sets it.
            scopeAnnounced: true,
            activeConversationScope: unchanged ? current : merged,
            activeConversationId: unchanged ? state.activeConversationId : null,
            historyLoadConversationId: unchanged ? state.activeConversationId : null,
            conversationEpoch: unchanged ? state.conversationEpoch : state.conversationEpoch + 1,
          };
        }),

      // Through `get()` rather than the exported hook: referring to the store
      // from inside its own initializer makes its type circular, and TypeScript
      // silently answers `any` — which lands as an implicitly-any selector
      // parameter in every unrelated component that reads this store.
      resetForProject: (projectId) => get().resetForScope({ projectId }),
    }),
    {
      name: "langy:store",
      // Durable across sessions, so a refresh puts the user back exactly where they
      // were: the panel's open/closed state, its layout (floating or docked), developer
      // mode, and WHICH CONVERSATION was open.
      partialize: (state) => ({
        isOpen: state.isOpen,
        devMode: state.devMode,
        panelMode: state.panelMode,
        panelEffect: state.panelEffect,
        activeConversationId: state.activeConversationId,
        activeConversationScope: state.activeConversationScope,
      }),
    },
  ),
);

/** The candidates the user has actually chosen — what the composer shows and
 *  what the turn carries. */
export function selectVisibleChips(
  candidates: LangyContextChip[],
  chosen: Set<string>,
): LangyContextChip[] {
  return candidates.filter((chip) => chosen.has(chip.id));
}

/** Everything the page is OFFERING that hasn't been taken — the "+ context"
 *  add menu, and now the common case rather than the leftovers. */
export function selectAddableChips(
  candidates: LangyContextChip[],
  chosen: Set<string>,
): LangyContextChip[] {
  return candidates.filter((chip) => !chosen.has(chip.id));
}

/**
 * Adapt surface-attached context into the chip shape the sidebar and the agent's
 * page-context both speak — so an attached item renders and forwards exactly like a
 * derived chip.
 */
export function attachedContextToChip(item: LangyAttachedContext): LangyContextChip {
  return {
    id: `${item.type}:${item.id}`,
    kind: item.type,
    label: item.label,
    ref: item.id,
  };
}
