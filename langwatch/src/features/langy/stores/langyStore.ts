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
} from "@langwatch/langy";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LangyResourceKind } from "~/shared/langy/langyResourceKinds";

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
 * `LangyProvider key={projectSlug}` forces), so scoped state is reset explicitly
 * whenever the SCOPE changes — see `resetForScope`.
 */

/**
 * Who and where the panel's state belongs to.
 *
 * Not just the project, and that is the correction: a conversation, a draft, a
 * picked trace row and a model override all belong to one signed-in user, in one
 * organization, working on one project. Any of the three changing makes the
 * state stale, and two of them used to change with nothing happening at all —
 * most sharply when the SAME project is open and the account changes underneath
 * it (a shared machine, an impersonation session), where the project id alone
 * says nothing has moved.
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
 *
 * Callers see different amounts: the panel only has the project, the layout has
 * all three. Merging rather than replacing is what keeps the partial caller from
 * looking like a scope CHANGE (which would wipe the very conversation a refresh
 * is meant to restore).
 */
function mergeScope(
  current: LangyScope | null,
  update: Partial<LangyScope>,
): LangyScope {
  return { ...(current ?? UNKNOWN_SCOPE), ...update };
}

function isSameScope(a: LangyScope | null, b: LangyScope | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.userId === b.userId &&
    a.organizationId === b.organizationId &&
    a.projectId === b.projectId
  );
}

/**
 * A removable page-context chip that rides INSIDE the composer surface (e.g.
 * "Experiment: my-slug", "Trace: abc123", "Project: web-app"). Page context is
 * derived from the current route / LangyContext (see `useLangyPageContext`);
 * this store only tracks which of those the user CHOSE. Derivation is an offer,
 * not context — nothing reaches the agent until someone picks it.
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
 * with Langy's own activity (never the cursor); `plain` is no effect, just the
 * themed surface. Both layouts (floating card and sidebar dock) share the one
 * effect and motion driver. Defaults to `fold`; user-picked, persisted.
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

interface LangyState extends TurnPhaseState {
  // Panel visibility. `false` is MINIMISED, not gone: the panel sinks to its
  // edge peek (the panel itself slides down — a sliver of its header at the bottom in
  // floating mode, of the dock's spine on the right edge in sidebar mode)
  // with the conversation, draft and layout choice untouched underneath.
  // `openPanel` — the peek's click/Enter, the Cmd/Ctrl+I toggle, an askLangy
  // handoff — brings the same surface back. Exactly ONE minimised affordance
  // renders at a time: the peek behind release_ui_langy_peek_dock_enabled,
  // the classic launcher orb while that flag is off (see LangySidecar).
  // Spec: specs/langy/langy-peek-dock.feature
  isOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;

  /**
   * The one-time "you can hand me things off the page" hint has been retired.
   *
   * Persisted per browser, and set two ways: the user dismisses it, or they do
   * the thing it teaches (see `absorbContextTarget`). Teaching a gesture is
   * worth exactly one showing — a hint that comes back is an ad.
   */
  contextHintDismissed: boolean;
  dismissContextHint: () => void;

  // Command-bar → panel handoff: a question queued from the Cmd+K "Ask Langy"
  // activation, auto-sent by the panel once it is mounted and idle. Ephemeral
  // (never persisted) — it exists only for the hop between the bar and the panel.
  pendingPrompt: string | null;
  /** Open Langy on a fresh conversation and queue `prompt` to auto-send. */
  askLangy: (prompt: string) => void;
  /** The panel has taken the queued prompt — clear it so it fires once. */
  consumePendingPrompt: () => void;

  /**
   * An `askLangy` handoff also asks the panel's composer to take focus: the
   * reader just handed a question over and expects to keep typing, not to
   * click the field first. A flag rather than an imperative call because the
   * composer may not be mounted yet when the handoff fires — it honors the
   * request on mount or on change, then consumes it so focus is taken exactly
   * once. Ephemeral, like `pendingPrompt`.
   */
  composerFocusRequested: boolean;
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

  /**
   * The home page's ask field is in use right now.
   *
   * The field and Langy's panel are two ways to say the same thing, so a
   * minimised Langy stands down while someone is typing into the field rather
   * than peeking out from under its results. Never persisted: it mirrors what
   * the reader is doing this second, and a page that reloaded into "the field
   * is focused" when it is not would leave Langy hidden with nothing to
   * un-hide it.
   */
  homeAskOpen: boolean;
  setHomeAskOpen: (open: boolean) => void;

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
  /**
   * Conversations THIS tab created whose read-side projection has not yet
   * been seen. The create command is accepted before the projection lands, so
   * a not-found from the history read is "not yet", never an error, until a
   * durable confirmation arrives — a successful read, or a freshness signal
   * naming the conversation. Session-scoped on purpose: never persisted (a
   * refreshed tab reads before it writes, so the window doesn't exist there).
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
  setModelOverride: (model: string) => void;
  /**
   * The project's coding default changed server-side (a codex connect flow
   * wrote the LANGY role default). Follow it with the composer's pill ONLY
   * when the pill is still on the default it replaced: an empty override, or
   * one equal to the outgoing default (the panel seeds the override from the
   * resolved default on open), both mean the user never explicitly diverged.
   * A model the user picked on purpose is never hijacked.
   */
  followCodingDefaultChange: (change: {
    previousDefault: string | null;
    nextDefault: string;
  }) => void;

  /**
   * Page-context chips the user has CHOSEN, by id.
   *
   * Opt-IN, and the direction is the whole point. This used to be a dismissed
   * set: everything Langy could derive from the page rode along automatically
   * and you removed what you didn't want. That is backwards — it meant simply
   * having the panel open on a busy page silently handed the agent a pile of
   * context nobody asked it to consider, and the only way to find out was to
   * read the chips. Now the page merely OFFERS; nothing is context until it is
   * picked.
   */
  chosenChipIds: Set<string>;
  /** Take a candidate chip into context. */
  chooseChip: (id: string) => void;
  /** Drop a chosen chip — the chip's own ✕. */
  dismissChip: (id: string) => void;
  resetChosenChips: () => void;

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
  // "not for this answer", not "never again"; the cross-session quiet period is
  // the backend's job (langy.messages `shouldAskFeedback` + langy.feedbackPromptShown).
  dismissedFeedbackMessageIds: Set<string>;
  dismissFeedback: (messageId: string) => void;
  /**
   * The assistant message whose feedback card must stay rendered regardless of
   * the server cadence flag. Two producers: a shown card pins itself (so the
   * refetch that follows `feedbackPromptShown` cannot unmount it mid-look), and
   * the `/feedback` composer command pins on demand. Conversation-scoped.
   */
  pinnedFeedbackMessageId: string | null;
  pinFeedback: (messageId: string) => void;

  // The turn phase — the SINGLE, event-driven source for the composer's send/stop
  // affordance and every "is a turn in flight" read (ADR-058). It replaces the
  // old scatter of isBusy / serverTurnInFlight / isStopping / settled-marker
  // booleans derived per-render across the panel: components read `turnPhase`,
  // and it changes ONLY through the four actions below.
  //   idle     — no turn in flight; the composer can send.
  //   active   — a turn is in flight (this tab's send OR the durable fold — incl.
  //              another tab / a resume after refresh); sending is disabled and
  //              Stop is offered.
  //   stopping — Stop was clicked; awaiting the backend's confirmed terminal.
  // Conversation-scoped (reset on switch / new chat), never persisted. The
  // ChatTransport adopts the turn id and pushes live signals off the
  // `langy.onTurnStream` subscription; `useLangyTurnSignals` reads those.
  //
  // The phase STATE fields (turnPhase, activeTurnId, settledTurnId,
  // backendSawTurnInFlight) come from `TurnPhaseState`; the machine's pure
  // transitions live in @langwatch/langy's turnPhase.ts. The store exposes them as events:
  /** A turn was dispatched (transport adopted its ids): adopt it, go `active`. */
  beginTurn: (args: { conversationId: string; turnId: string }) => void;
  /** The user hit Stop: `active` → `stopping` (a no-op in any other phase). */
  requestStop: () => void;
  /**
   * The stop request never reached the backend: `stopping` → `active`. The
   * spinner is a promise that a stop is on its way, so it may not outlive a
   * request that failed to go out.
   */
  abandonStop: () => void;
  /**
   * Reconcile with the DURABLE fold — the tab-independent truth of whether a
   * turn is in flight. Feeds `active` for a turn this tab did not start (another
   * tab, a resume after refresh) and settles to `idle` once the fold that
   * CONFIRMED the turn goes idle. Never keyed on the client stream's flaky
   * isBusy — which is exactly how a premature second send used to slip through
   * the moment the first token arrived and 409 the in-flight turn.
   */
  observeBackendTurn: (inFlight: boolean) => void;
  /** A genuine end-of-turn frame settled the turn: go `idle` immediately. */
  settleTurn: (turnId: string | null) => void;
  /**
   * The LOCAL turn projection (ADR-059): the durable event tail folded through
   * the same reducer the server projection runs. Seeded from the conversation
   * snapshot, advanced by `applyTurnEvents`, and composed with the phase
   * machine — a folded terminal settles the phase, a folded running turn
   * confirms it, both replayable from the recorded events.
   */
  turnProjection: LangyTurnProjectionState;
  /**
   * Adopt a conversation snapshot's position (cursor + in-flight turn id).
   * When the snapshot names a turn in flight and this tab tracks none, the tab
   * adopts it — which is what makes Stop (and the live stream) work after a
   * refresh. Never rewinds a fresher local fold.
   */
  seedTurnProjection: (snapshot: {
    cursor: LangyEventCursor | null;
    currentTurnId?: string | null;
  }) => void;
  /** Fold a fetched durable tail; idempotent under re-delivery and overlap. */
  applyTurnEvents: (events: readonly LangyConversationTurnWireEvent[]) => void;
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

  /**
   * The scope `activeConversationId` belongs to. Persisted alongside it so a
   * restored conversation can be proven to belong HERE — see `resetForScope`.
   */
  activeConversationScope: LangyScope | null;

  /**
   * True once `resetForScope` has run in THIS page load. Never persisted.
   *
   * It is what tells the two kinds of same-scope announcement apart: the FIRST
   * one after a load is the refresh-restore (rehydrated conversation, arm the
   * history load, sweep the previous session's ephemera), and every one after
   * it is a heartbeat — `useOrganizationTeamProject` momentarily reports no
   * project while it refetches, so its effect re-fires with the same three ids
   * every time the window regains focus. Without this flag each of those
   * re-announcements re-ran the sweep, and the user's grabbed context chips,
   * draft and live turn signals vanished mid-conversation for no visible
   * reason.
   */
  scopeAnnounced: boolean;

  /**
   * Bumped whenever the panel starts over: a new chat, an `askLangy` handoff, or
   * a scope change. It is the one signal the sibling stores follow, so "what
   * else has to be forgotten" is answered in one place instead of every store
   * growing its own copy of the project/org/user wiring. See the subscription in
   * `langyContextTargetStore`.
   */
  conversationEpoch: number;

  // Resets
  /**
   * Entering a scope — a signed-in user, in an organization, on a project.
   * Restores the conversation that was open in THIS scope, and clears everything
   * else the previous one left behind.
   *
   * Takes a PARTIAL scope: callers know different amounts (see `mergeScope`).
   */
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
  turnProgress: null as number | null,
  turnProgressSample: null as LangyProgressSample | null,
  turnReasoning: null as string | null,
  turnPlan: null as Array<{ content: string; status: string }> | null,
  // A fresh conversation drops any question still queued for the previous one.
  pendingPrompt: null as string | null,
});

/**
 * The ONLY state allowed to cross a change of user, organization or project.
 *
 * The reset below is deliberately inverted: it walks the store's own initial
 * state and clears everything it finds, except what is named here. A list of
 * things to CLEAR is a list somebody has to remember to extend, and the cost of
 * forgetting is invisible — one project's trace ids quietly offered as context
 * in another. A list of things to KEEP fails the other way: a new field is
 * forgotten INTO the reset, which is the harmless direction.
 *
 * Each entry earns its place:
 *   isOpen, panelMode, panelEffect, devMode, contextHintDismissed
 *     — browser-level preferences. They describe how this person likes the panel,
 *       not what they were looking at. Closing the panel or forgetting that the
 *       gesture hint was already retired, every time somebody changes project,
 *       would be a bug of its own.
 *   dockShellClaims, dockShifted
 *     — not preferences and not data: a live count of what is mounted RIGHT NOW.
 *       Zeroing them would tell the app shell the dock is free while it is still
 *       holding it, and the page would jump.
 *
 * Everything else — conversation pointer, draft, chosen chips, attached context,
 * model override, proposal lifecycle, feedback dismissals, live turn signals,
 * the developer card gallery — is scoped, and goes.
 */
const SCOPE_INDEPENDENT_KEYS: ReadonlySet<string> = new Set<keyof LangyState>([
  "isOpen",
  "panelMode",
  "panelEffect",
  "devMode",
  "contextHintDismissed",
  "dockShellClaims",
  "dockShifted",
]);

/**
 * Every scoped field, back at its initial value.
 *
 * Read off `getInitialState()` rather than a hand-written literal, so the store's
 * shape IS the reset's shape: a field added tomorrow is cleared tomorrow, with
 * nobody having to notice. Actions are skipped by type (they are the only
 * functions in here); collections are copied so two resets can never hand out
 * the same mutable instance.
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

      contextHintDismissed: false,
      dismissContextHint: () =>
        set((state) =>
          state.contextHintDismissed ? state : { contextHintDismissed: true },
        ),
      togglePanel: () => set((state) => ({ isOpen: !state.isOpen })),

      pendingPrompt: null,
      askLangy: (prompt) =>
        set(() => ({
          isOpen: true,
          // A fresh ask starts a clean conversation, mirroring
          // startNewConversation (the chat engine is reset panel-side when the
          // queued prompt is consumed) — with ONE deliberate difference: the
          // context the user just grabbed RIDES ALONG. `chosenChipIds` is kept
          // and the epoch is NOT bumped (the bump is what tells the target
          // store to drop its picks), because pointing at a thing on the page
          // and then asking about it is the ordinary order of the gesture —
          // arm, absorb, ask. Wiping the picks here made the whole grabbing
          // flow look dead: the chip appeared, the ask opened the panel, and
          // the turn went out knowing nothing. The chips stay visible in the
          // composer, so what rides along is still exactly what the user sees.
          activeConversationId: null,
          historyLoadConversationId: null,
          draft: "",
          ...emptyConversationState(),
          // AFTER the spread: emptyConversationState() nulls `pendingPrompt`, so
          // the queued question is written last or it would be wiped out.
          pendingPrompt: prompt.trim() || null,
          // The reader expects to keep typing in the panel they just opened.
          composerFocusRequested: true,
        })),
      consumePendingPrompt: () => set({ pendingPrompt: null }),

      composerFocusRequested: false,
      consumeComposerFocus: () => set({ composerFocusRequested: false }),

      // Sidebar by default: docked inside the app shell as a second content
      // card, working alongside the page. Floating stays one toggle away in
      // the overflow menu (user-picked, persisted).
      panelMode: "sidebar",
      setPanelMode: (panelMode) => set({ panelMode }),
      // `fold` is the default: the two-tone brand fold IS the panel's design,
      // and shipping the undecorated surface as the default meant nobody saw
      // it unless they went looking in a menu. `plain` stays one toggle away.
      //
      // This is the default for state that has never been set. `panelEffect`
      // is persisted, so anyone who already chose an effect keeps their choice
      // — the change reaches new sessions and untouched installs, not people
      // who have already decided.
      panelEffect: "fold",
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

      homeAskOpen: false,
      setHomeAskOpen: (homeAskOpen) => set({ homeAskOpen }),

      activeConversationId: null,
      activeConversationScope: null,
      scopeAnnounced: false,
      conversationEpoch: 0,
      historyLoadConversationId: null,
      selectConversation: (id) =>
        set({
          activeConversationId: id,
          historyLoadConversationId: id,
          ...emptyConversationState(),
        }),
      adoptConversation: (id) => set({ activeConversationId: id }),
      startNewConversation: () =>
        set((state) => ({
          activeConversationId: null,
          historyLoadConversationId: null,
          // A new chat starts on a BLANK composer. Without this, the half-typed
          // text abandoned in the last conversation is still sitting there,
          // primed to be sent into the new one. (`resetForScope` already
          // cleared the draft — it was simply missed here.)
          draft: "",
          chosenChipIds: new Set<string>(),
          // The targets the user pointed at were gathered for the conversation
          // being left behind; the epoch is what tells the target store to let
          // them go (see its subscription).
          conversationEpoch: state.conversationEpoch + 1,
          ...emptyConversationState(),
        })),
      consumeHistoryLoad: () => set({ historyLoadConversationId: null }),

      draft: "",
      setDraft: (draft) => set({ draft }),
      modelOverride: "",
      setModelOverride: (modelOverride) => set({ modelOverride }),
      followCodingDefaultChange: ({ previousDefault, nextDefault }) =>
        set((state) =>
          state.modelOverride === "" || state.modelOverride === previousDefault
            ? { modelOverride: nextDefault }
            : state,
        ),

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
          turnProgress: null,
          turnProgressSample: null,
          turnReasoning: null,
          turnPlan: null,
        })),
      unconfirmedConversations: {},
      confirmConversation: (id) =>
        set((s) => {
          if (!s.unconfirmedConversations[id]) return s;
          const { [id]: _confirmed, ...rest } = s.unconfirmedConversations;
          return { unconfirmedConversations: rest };
        }),
      requestStop: () => set((s) => reduceRequestStop(s)),
      abandonStop: () => set((s) => reduceAbandonStop(s)),
      observeBackendTurn: (inFlight) =>
        set((s) => reduceObserveBackendTurn(s, inFlight)),
      settleTurn: (turnId) => set((s) => reduceSettleTurn(s, turnId)),

      // The local turn projection (ADR-059) — pure reducers from
      // @langwatch/langy, composed with the phase machine in the two places
      // durable truth arrives: the snapshot seed and the folded tail.
      turnProjection: initialLangyTurnProjection,
      seedTurnProjection: (snapshot) =>
        set((s) => {
          const turnProjection = seedLangyTurnProjection(
            s.turnProjection,
            snapshot,
          );
          // Refresh-resume: the durable record names a turn in flight and this
          // tab tracks none — adopt it so Stop targets it and live signals
          // route to it. `activeTurnId === null` keeps a mid-send tab from
          // being clobbered; requiring the seed to have ADVANCED the fold
          // (the reducer returns the same reference for a stale snapshot)
          // keeps a lagging refetch from resurrecting a finished turn. Never
          // guard on the phase: the observeBackendTurn effect flips it to
          // `active` in this same commit, before this reducer runs.
          const adoptTurnId =
            snapshot.currentTurnId &&
            s.activeTurnId === null &&
            turnProjection !== s.turnProjection
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
            // The settle marker exists to gag the fold RE-ASSERTING the turn
            // whose end frame already landed (its projection lags). A running
            // turn with a DIFFERENT id is not that — it is a genuinely new
            // turn (another tab's send, a re-driven turn), and the stale
            // marker must not demote it to idle. Clear it, and drop the
            // settled turn's id with it so the new turn is adopted.
            const base =
              s.settledTurnId !== null &&
              turnProjection.turnId !== s.settledTurnId
                ? {
                    ...s,
                    settledTurnId: null,
                    activeTurnId:
                      s.activeTurnId === s.settledTurnId
                        ? null
                        : s.activeTurnId,
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

      /**
       * Called when the panel enters a scope — a user, an organization, a
       * project.
       *
       * It has to serve two cases that look identical from in here — a page
       * REFRESH (rehydrated from localStorage; the user expects to come back to
       * exactly what they left) and a SCOPE CHANGE (the store is a module
       * singleton that survives the per-project remount, so the last scope's
       * conversation is still sitting in it and must not follow them across).
       *
       * The persisted scope is what tells them apart. A conversation is restored
       * only when it provably belongs to the scope being entered; anything else
       * clears, and clears COMPLETELY — see `scopedInitialState`, which is
       * derived from the store's own shape rather than from a list of fields
       * somebody has to keep in step.
       *
       * Restoring also ARMS the history load, because `activeConversationId`
       * alone is just a pointer — the chat engine hydrates off
       * `historyLoadConversationId`, so without it the panel would show the
       * right title over an empty thread.
       */
      resetForScope: (scope) =>
        set((state) => {
          const current = state.activeConversationScope;
          const merged = mergeScope(current, scope);
          const unchanged = !!current && isSameScope(current, merged);
          // A re-announcement of the scope we are already in is a heartbeat,
          // not a move — the org/project hook re-fires on every refetch (window
          // focus included) with the same three ids. Only the FIRST unchanged
          // announcement per page load does the refresh-restore below; after
          // that, sweeping again would wipe the user's grabbed context chips,
          // draft and live turn state mid-conversation. See `scopeAnnounced`.
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
            historyLoadConversationId: unchanged
              ? state.activeConversationId
              : null,
            conversationEpoch: unchanged
              ? state.conversationEpoch
              : state.conversationEpoch + 1,
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
      // Durable across sessions, so a refresh puts the user back exactly where
      // they were: the panel's open/closed state, its layout (floating or
      // docked), developer mode, and WHICH CONVERSATION was open.
      //
      // `isOpen` persisting never forces the panel onto a surface that has no
      // Langy — the visibility gate (useShowLangy) still decides whether it
      // renders at all.
      //
      // The conversation persists as a PAIR: the id and the SCOPE it belongs to
      // — user, organization, project. On its own the id is unsafe, because the
      // store is a module singleton (and localStorage is shared by everyone who
      // uses this browser), so a switch would carry it somewhere it does not
      // exist, or worse, somewhere it exists and does not belong.
      // `resetForScope` compares the two and restores only on a match.
      //
      // Everything else — the draft, the live turn, chosen chips, proposal
      // lifecycle — is per-session state that must start clean.
      partialize: (state) => ({
        isOpen: state.isOpen,
        devMode: state.devMode,
        contextHintDismissed: state.contextHintDismissed,
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
