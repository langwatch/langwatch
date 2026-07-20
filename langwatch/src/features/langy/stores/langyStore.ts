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
    | "scenario"
    // An evaluation / evaluator / monitor the user has open (usually via a
    // drawer). Distinct from `experiment` — this is a single evaluator or
    // online-evaluation, not an offline experiment run.
    | "evaluation"
    // A multi-row selection the user made in the Trace Explorer table
    // ("N traces selected"). `ref` carries the selected ids (comma-joined)
    // so the agent can act on exactly what's checked.
    | "selection"
    // An active filter / query on the Trace Explorer ("filtered: <summary>"),
    // so the agent scopes "these traces" to what the user has narrowed to.
    | "filter";
  label: string;
  /**
   * The resource ref (id / slug) this chip stands for, forwarded to the agent
   * as turn context. Absent for the project chip (the project is implicit).
   */
  ref?: string;
}

/**
 * A capability the user has explicitly asked Langy to use on the next turn.
 *
 * `targetChipId` is the ASSOCIATION: the id of a `LangyContextChip` this skill
 * is aimed at, expressing "use the GitHub skill, on this trace" as one thought
 * rather than two chips sitting next to each other hoping the agent guesses.
 * Null means the skill has no specific target — a perfectly good state, and the
 * default until the user says otherwise.
 *
 * It stores the chip's ID, not its label: labels change (a title reactor lands,
 * a filter is edited) and a binding that silently pointed at a stale string
 * would be worse than no binding. The label is resolved at send time, from the
 * chip that is actually present — and if that chip has since been removed, the
 * binding resolves to nothing rather than to a lie.
 */
export interface LangySkillChip {
  /** Feature-map feature id, or agent skill name. See ~/shared/langy/langySkills.ts. */
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
 * A piece of context a SURFACE explicitly hands to Langy — the home briefing's
 * "look at this receipt", a card's "work from this", anything off the current
 * route. Distinct from the page-derived chips (which Langy infers from the URL /
 * open drawer) and from the picked page targets (which follow the DOM): this is
 * an intentional, surface-driven attach that outlives the element it came from.
 *
 * `type` reuses the context-chip kind vocabulary so an attached item forwards to
 * the agent as page context with no translation, and so the sidebar can pick the
 * right icon. `id` is the resource ref that rides to the agent; `label` is the
 * human name shown in the sidebar; `meta` carries anything a surface wants to
 * keep for display (a value, a severity) without widening the wire shape.
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
 * How the panel is laid out (Notion-style). `floating` = a rounded card that
 * overlays the page (and floats above a drawer); `sidebar` = a full-height right
 * dock that pushes page content left (a drawer nests to its left). User-picked,
 * persisted.
 */
export type LangyPanelMode = "floating" | "sidebar";

/**
 * Which decorative treatment the panel wears — an interim design-comparison
 * switch (see LangyWave). `fold` is the two-tone brand fold whose seam moves
 * with Langy's own activity (never the cursor); `split` is a black↔white
 * invert split across that same moving seam; `plain` is no effect, just the
 * themed surface. Both layouts (floating card and sidebar dock) share the one
 * effect and motion driver. User-picked, persisted.
 */
export type LangyPanelEffect = "fold" | "plain";

/**
 * One measured batch-progress observation from the worker. `receivedAtMs` is
 * stamped by the browser when the frame arrives; together with the observed
 * batch size/duration it lets the status line interpolate between real X/Y
 * samples without making timing part of durable conversation state.
 */
export interface LangyProgressSample {
  current: number;
  total: number;
  batchItems?: number;
  batchDurationMs?: number;
  receivedAtMs: number;
}

interface LangyState {
  // Panel visibility
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

  // Layout mode (Floating / Sidebar) — user-picked, persisted
  panelMode: LangyPanelMode;
  setPanelMode: (mode: LangyPanelMode) => void;

  // Floating-panel decorative treatment (Fold / Split / Plain) — persisted
  panelEffect: LangyPanelEffect;
  setPanelEffect: (effect: LangyPanelEffect) => void;

  /**
   * How many mounted app shells have claimed the docked panel's placement.
   *
   * The app shell (DashboardLayout) draws the page as a rounded content card
   * on the gray page ground. When such a shell is mounted it CLAIMS the dock:
   * it reserves the panel's room inside its own content row (keeping the
   * header full-width) and the docked panel renders as a second rounded card
   * below the header. Pages without a shell (full-screen tools like the
   * studio) leave the count at zero and keep the flush full-height dock with
   * the page-level width reservation. A count, not a boolean, so nested or
   * twin mounts (StrictMode) stay correct. Never persisted: it mirrors what
   * is mounted right now. Spec: specs/langy/langy-panel-layout.feature
   */
  dockShellClaims: number;
  claimDockShell: () => void;
  releaseDockShell: () => void;

  /**
   * The docked panel is open and reserving room right now, the one truth the
   * page wrapper computes (visibility gate + open + sidebar mode, see
   * LangyShiftedRoot) and the app shell consumes to reserve the dock's room
   * inside its content row. Kept in the store so the shell never re-derives
   * Langy's visibility gating (which needs session hooks a public shell must
   * not run). Never persisted.
   */
  dockShifted: boolean;
  setDockShifted: (shifted: boolean) => void;

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

  /**
   * Context handed to Langy by a SURFACE (a home card, a briefing receipt, any
   * "attach this" affordance). The clean, typed entry point every surface uses;
   * read `attachedContext` to LIST it. Deduped by `id` (a second attach of the
   * same id refreshes its label/meta rather than stacking a duplicate).
   */
  attachedContext: LangyAttachedContext[];
  attachContext: (item: LangyAttachedContext) => void;
  detachContext: (id: string) => void;
  clearAttachedContext: () => void;

  /**
   * Skill chips the user has attached to the next turn.
   *
   * A resource chip says "look at this"; a skill chip says "DO this". They are
   * separate state because they are separate grammar — nouns and verbs — and
   * because a skill is chosen deliberately, where page context arrives on its
   * own from the route.
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
  // "not for this answer", not "never again"; the long cross-session snooze is
  // localStorage's job (see logic/langyFeedbackDirective).
  dismissedFeedbackMessageIds: Set<string>;
  dismissFeedback: (messageId: string) => void;

  // The in-flight turn + its live status/progress signals. The ChatTransport
  // adopts the turn id and pushes signals off the `langy.onTurnStream`
  // subscription; `useLangyTurnSignals` reads them into `StreamingStatusLine`.
  // Conversation-scoped (reset on switch / new turn), never persisted.
  activeTurnId: string | null;
  setActiveTurnId: (id: string | null) => void;
  /** Latest coarse status line for the turn (e.g. "Searching traces…"). */
  turnStatus: string | null;
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
   * last-snapshot-wins. Ephemeral — the plan card prefers it over parsing the
   * raw `todowrite` tool part while the turn streams; the durable fold is
   * canonical on reload. Null until the turn reports a plan.
   */
  turnPlan: Array<{ content: string; status: string }> | null;
  setTurnStatus: (status: string | null) => void;
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
   * Developer-mode card gallery: renders every card Langy can produce, with
   * fixture data, in place of the conversation. Deliberately NOT persisted — it
   * is a debugging lens you open, look through, and close, not a mode you leave
   * a browser in.
   */
  cardGalleryOpen: boolean;
  toggleCardGallery: () => void;
  closeCardGallery: () => void;

  // Resets
  /** Full reset when the active project changes (the store is a singleton). */
  resetForProject: () => void;
}

const emptyConversationState = () => ({
  // Skills steer ONE turn. Carrying "use GitHub" silently into the next
  // conversation would be the panel making decisions on the user's behalf.
  skillChips: [] as LangySkillChip[],
  appliedOutcomes: {} as Record<string, LangyAppliedOutcome>,
  discardedProposalIds: new Set<string>(),
  applyingProposalIds: new Set<string>(),
  dismissedFeedbackMessageIds: new Set<string>(),
  activeTurnId: null as string | null,
  turnStatus: null as string | null,
  turnProgress: null as number | null,
  turnProgressSample: null as LangyProgressSample | null,
  turnReasoning: null as string | null,
  turnPlan: null as Array<{ content: string; status: string }> | null,
  // A fresh conversation drops any question still queued for the previous one.
  pendingPrompt: null as string | null,
});

export const useLangyStore = create<LangyState>()(
  persist(
    (set) => ({
      isOpen: false,
      openPanel: () => set({ isOpen: true }),
      closePanel: () => set({ isOpen: false }),
      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      pendingPrompt: null,
      askLangy: (prompt) =>
        set({
          isOpen: true,
          // A fresh ask starts a clean conversation, mirroring
          // startNewConversation (the chat engine is reset panel-side when the
          // queued prompt is consumed).
          activeConversationId: null,
          historyLoadConversationId: null,
          draft: "",
          dismissedChipIds: new Set<string>(),
          ...emptyConversationState(),
          // AFTER the spread: emptyConversationState() nulls `pendingPrompt`, so
          // the queued question is written last or it would be wiped out.
          pendingPrompt: prompt.trim() || null,
        }),
      consumePendingPrompt: () => set({ pendingPrompt: null }),

      // Sidebar by default: docked inside the app shell as a second content
      // card, working alongside the page. Floating stays one toggle away in
      // the overflow menu (user-picked, persisted).
      panelMode: "sidebar",
      setPanelMode: (panelMode) => set({ panelMode }),
      panelEffect: "plain",
      setPanelEffect: (panelEffect) => set({ panelEffect }),

      dockShellClaims: 0,
      claimDockShell: () =>
        set((state) => ({ dockShellClaims: state.dockShellClaims + 1 })),
      releaseDockShell: () =>
        set((state) => ({
          dockShellClaims: Math.max(0, state.dockShellClaims - 1),
        })),

      dockShifted: false,
      setDockShifted: (dockShifted) => set({ dockShifted }),

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
          // A new chat starts on a BLANK composer. Without this, the half-typed
          // text abandoned in the last conversation is still sitting there,
          // primed to be sent into the new one. (`resetForProject` already
          // cleared the draft — it was simply missed here.)
          draft: "",
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

      attachedContext: [],
      attachContext: (item) =>
        set((state) => {
          const existingIndex = state.attachedContext.findIndex(
            (attached) => attached.id === item.id,
          );
          // Re-attaching an id is a refresh, not a duplicate: replace in place so
          // a label/meta that changed (a title reactor landed) updates without
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
            attachedContext: state.attachedContext.filter(
              (item) => item.id !== id,
            ),
          };
        }),
      clearAttachedContext: () =>
        set((state) =>
          state.attachedContext.length === 0 ? state : { attachedContext: [] },
        ),

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

      activeTurnId: null,
      setActiveTurnId: (activeTurnId) => set({ activeTurnId }),
      turnStatus: null,
      turnProgress: null,
      turnProgressSample: null,
      turnReasoning: null,
      turnPlan: null,
      setTurnStatus: (turnStatus) => set({ turnStatus }),
      setTurnProgress: (turnProgress) => set({ turnProgress }),
      setTurnProgressSample: (turnProgressSample) =>
        set({ turnProgressSample }),
      appendTurnReasoning: (text) =>
        set((s) => ({ turnReasoning: (s.turnReasoning ?? "") + text })),
      setTurnPlan: (turnPlan) => set({ turnPlan }),
      resetTurnSignals: () =>
        set({
          turnStatus: null,
          turnProgress: null,
          turnProgressSample: null,
          turnReasoning: null,
          turnPlan: null,
        }),

      devMode: false,
      // Leaving dev mode takes the gallery with it — otherwise a user who
      // toggles dev mode off is left staring at a wall of fixtures.
      setDevMode: (devMode) =>
        set(devMode ? { devMode } : { devMode, cardGalleryOpen: false }),

      cardGalleryOpen: false,
      toggleCardGallery: () =>
        set((state) => ({ cardGalleryOpen: !state.cardGalleryOpen })),
      closeCardGallery: () => set({ cardGalleryOpen: false }),

      resetForProject: () =>
        set({
          activeConversationId: null,
          historyLoadConversationId: null,
          draft: "",
          dismissedChipIds: new Set<string>(),
          // Context attached on one project's surfaces must not bleed into the
          // next — the store is a module singleton across the project remount.
          attachedContext: [],
          ...emptyConversationState(),
        }),
    }),
    {
      name: "langy:store",
      // Durable across sessions: developer mode + the layout mode. Everything
      // else is per-session client state that must start clean (the panel opens
      // empty by default).
      partialize: (state) => ({
        devMode: state.devMode,
        panelMode: state.panelMode,
        panelEffect: state.panelEffect,
      }),
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

/**
 * Adapt surface-attached context into the chip shape the sidebar and the agent's
 * page-context both speak — so an attached item renders and forwards exactly like
 * a derived chip. The chip id namespaces on kind + ref so an attached trace and a
 * route-derived one for the same trace collapse into one instead of stacking.
 */
export function attachedContextToChip(
  item: LangyAttachedContext,
): LangyContextChip {
  return {
    id: `${item.type}:${item.id}`,
    kind: item.type,
    label: item.label,
    ref: item.id,
  };
}
