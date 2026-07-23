import { create } from "zustand";
import { useLangyStore, type LangyContextChip } from "./langyStore";

/**
 * The registry of things on the page Langy can take as context.
 *
 * A "target" is any object a component declares itself to be — a trace row, a
 * trace drawer, an online evaluation card, an experiment row. Components opt in
 * with `useLangyContextTarget`, which registers them here while mounted and
 * de-registers on unmount. Registration alone changes nothing you can see: a
 * target only lights up, and only becomes clickable-into-context, while the
 * page is ARMED (`#`, or a held Shift — see `armSource`).
 *
 * Deliberately a SEPARATE store from `langyStore`:
 *   - Registration churns. A virtualized trace table mounts and unmounts rows
 *     on every scroll tick; that write traffic has no business waking up the
 *     panel's conversation / composer / proposal subscribers.
 *   - The lifetimes differ. `targets` follows the DOM; `picked` follows the
 *     user's intent and must OUTLIVE the DOM (see below).
 *
 * Three slices, three lifetimes:
 *   targets       — what is on screen right now. Written by the registration
 *                   effect. Nothing outside the hook subscribes to it, so its
 *                   churn costs one no-op selector run per target.
 *   picked        — what the user clicked. Held as full target COPIES, not ids
 *                   into `targets`, because a picked trace row that scrolls out
 *                   of the virtualizer unmounts — and its chip must not vanish
 *                   with it.
 *   activeChipIds — the ids of the chips the composer is actually showing right
 *                   now, published by `useLangyPageContext`. This is what makes
 *                   a target read as "added": it covers chips the user picked
 *                   AND chips Langy auto-derived from the route / open drawer,
 *                   so an already-in-context trace doesn't offer to be added
 *                   again.
 */

/**
 * A registrable page target. Structurally a `LangyContextChip` — a clicked
 * target IS the chip it becomes, so nothing has to be mapped at the boundary.
 */
export type LangyContextTarget = LangyContextChip;

/**
 * The drag payload's type, so the panel can tell a dragged context target from
 * the text, files and links the browser will happily hand it otherwise. A
 * custom MIME is also invisible to every other drop target on the page, so
 * dragging a trace row over an unrelated one can never do something surprising.
 */
export const LANGY_CONTEXT_DRAG_MIME = "application/x-langy-context";

/** Read a dragged target back off a drop event, or null if it isn't one. */
export function readDraggedTarget(
  transfer: DataTransfer | null,
): LangyContextTarget | null {
  const raw = transfer?.getData(LANGY_CONTEXT_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as LangyContextTarget).id === "string" &&
      typeof (parsed as LangyContextTarget).label === "string"
    ) {
      return parsed as LangyContextTarget;
    }
  } catch {
    // Another app's drag that happens to claim our MIME. Not ours; ignore it.
  }
  return null;
}

/**
 * The kinds the composer's `#` palette can ask to see on the page ("show me the
 * traces here") or be taken to ("browse datasets").
 *
 * Every chip kind that a card or row on some list page declares itself to be.
 * The two exclusions are not oversights: `selection` and `filter` describe table
 * STATE rather than a registrable page object, and `project` has no list of
 * itself to browse.
 */
export type LangyRevealableKind = Extract<
  LangyContextTarget["kind"],
  | "trace"
  | "dataset"
  | "prompt"
  | "evaluation"
  | "scenario"
  | "experiment"
  | "workflow"
  | "agent"
  | "automation"
  | "annotation"
  | "dashboard"
>;

/** How long a requested reveal stays lit (ms). One look, then it lets go. */
const REVEAL_DURATION_MS = 2600;
/**
 * Cap on simultaneously revealed targets. A reveal exists to say "things like
 * this, here" — thirty rings say that; five hundred is a christmas tree.
 */
const REVEAL_MAX_TARGETS = 30;
/**
 * A pending reveal ("browse traces" navigated somewhere and is waiting for the
 * rows to mount) that nothing has answered goes stale after this long, so a
 * page visited a minute later doesn't light up out of nowhere.
 */
const PENDING_REVEAL_TTL_MS = 15_000;

let revealTimer: ReturnType<typeof setTimeout> | null = null;

/** (Re-)arm the shared expiry. Re-arming on each late joiner keeps a burst of
 *  registrations (a table mounting row by row) lit as one reveal, not thirty. */
function armRevealTimer(): void {
  if (revealTimer) clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    revealTimer = null;
    useLangyContextTargetStore.getState().clearReveal();
  }, REVEAL_DURATION_MS);
}

/**
 * What put the page into pick-a-thing mode. `null` is disarmed.
 *
 * The two arm the same mode but release differently, which is why the source is
 * remembered rather than a bare boolean: `#` is a LATCH (press once, it stays
 * on until you press again, escape, or pick something), Shift is MOMENTARY (it
 * lasts exactly as long as you hold it). A keyup on Shift must not switch off a
 * mode that `#` turned on.
 */
export type LangyArmSource = "key" | "hold";

interface LangyContextTargetState {
  /** Targets mounted on the page right now, keyed by their stable chip id. */
  targets: Record<string, LangyContextTarget>;
  /** Targets the user clicked, in click order. Survives the target unmounting. */
  picked: LangyContextTarget[];
  /** Chip ids the composer is currently showing (auto-derived + picked). */
  activeChipIds: Set<string>;

  /**
   * Targets lit BY REQUEST rather than by pointer proximity — the composer's
   * `#trace` → "Show traces on this page" gesture. Rendered exactly like
   * `near`, briefly, then cleared by the shared timer.
   */
  revealedIds: Set<string>;
  /**
   * A reveal that found nothing to light up yet — asked for on one page,
   * answered on the next. `register` consumes it as matching targets mount.
   */
  pendingReveal: { kind: LangyRevealableKind; requestedAt: number } | null;

  /**
   * Proximity, written by `LangyContextTargetLayer` as the pointer moves.
   *
   * Targets do not all light up at once — that turns a page into a christmas
   * tree. They light up AROUND THE CURSOR: `nearIds` is everything within
   * reach of the pointer (a faint outline), `hoveredId` is the one actually
   * under it (a firmer outline, and the "Absorb context" button fades in over it).
   */
  nearIds: Set<string>;
  hoveredId: string | null;

  /**
   * The chip the user is pointing at INSIDE the panel — the other direction.
   *
   * Everything else here runs page → panel: point at a row, it becomes a chip.
   * This runs panel → page: hover "workflow: checkout" in the context list and
   * the workflow's own card lights up where it sits. Without it a chip is just
   * a word, and the user has to take the panel's word for which of nine cards
   * it means.
   *
   * Deliberately NOT `hoveredId`: that one is written every frame by the
   * pointer layer while armed, and a spotlight driven from the panel would be
   * overwritten before it painted.
   */
  spotlightId: string | null;
  setSpotlight: (id: string | null) => void;

  /**
   * The thing that was just taken into context, and a nonce so taking the SAME
   * thing twice replays rather than sits there already-equal and paints
   * nothing. Cleared by the flourish itself once it has finished.
   */
  absorbFlash: { id: string; nonce: number } | null;
  flashAbsorb: (id: string) => void;
  clearAbsorbFlash: (nonce: number) => void;

  /**
   * Pick-a-thing mode. Nothing on the page reacts to Langy until this is on —
   * no ring, no button, no click interception — so the page stays the page and
   * "add to context" is a mode you enter on purpose rather than a state the
   * open panel imposes on everything you look at.
   */
  armSource: LangyArmSource | null;
  arm: (source: LangyArmSource) => void;
  /** Release. `source` scopes it: a Shift keyup must not cancel a `#` latch. */
  disarm: (source?: LangyArmSource) => void;
  toggleArm: () => void;

  register: (target: LangyContextTarget) => void;
  unregister: (id: string) => void;

  pick: (target: LangyContextTarget) => void;
  unpick: (id: string) => void;
  clearPicked: () => void;

  /**
   * Light up every mounted target of `kind` for a moment — or, when none is
   * mounted (asked from a page without them), remember the ask so the targets
   * light up as they arrive on the next page.
   */
  requestReveal: (request: { kind: LangyRevealableKind }) => void;
  /**
   * Keep a reveal alive while the pointer is on one of its targets.
   *
   * A reveal is an offer with a timer on it, and an offer must not expire under
   * the hand reaching for it — the button would vanish mid-click and the row
   * would go back to opening its drawer. Re-arms the shared expiry only; writes
   * no state, so it is free to call on every pointer frame.
   */
  holdReveal: () => void;
  clearReveal: () => void;

  /** Published by `useLangyPageContext` on every chip-list change. */
  setActiveChipIds: (ids: string[]) => void;
  setProximity: (proximity: {
    nearIds: string[];
    hoveredId: string | null;
  }) => void;

  reset: () => void;
}

/** Same id AND same payload — a re-register with identical content is a no-op. */
function isSameTarget(a: LangyContextTarget, b: LangyContextTarget): boolean {
  return a.kind === b.kind && a.label === b.label && a.ref === b.ref;
}

export const useLangyContextTargetStore = create<LangyContextTargetState>()(
  (set) => ({
    targets: {},
    picked: [],
    activeChipIds: new Set<string>(),
    revealedIds: new Set<string>(),
    pendingReveal: null,
    nearIds: new Set<string>(),
    hoveredId: null,
    spotlightId: null,
    absorbFlash: null,
    armSource: null,

    setSpotlight: (id) =>
      set((state) => (state.spotlightId === id ? state : { spotlightId: id })),

    flashAbsorb: (id) =>
      set((state) => ({
        absorbFlash: { id, nonce: (state.absorbFlash?.nonce ?? 0) + 1 },
      })),

    clearAbsorbFlash: (nonce) =>
      set((state) =>
        state.absorbFlash?.nonce === nonce ? { absorbFlash: null } : state,
      ),

    arm: (source) =>
      set((state) => (state.armSource === source ? state : { armSource: source })),

    disarm: (source) =>
      set((state) => {
        if (state.armSource === null) return state;
        // A Shift keyup arriving while `#` holds the latch open is not a
        // release — it is a different gesture ending.
        if (source && state.armSource !== source) return state;
        return {
          armSource: null,
          nearIds: new Set<string>(),
          hoveredId: null,
        };
      }),

    toggleArm: () =>
      set((state) =>
        state.armSource === null
          ? { armSource: "key" as const }
          : { armSource: null, nearIds: new Set<string>(), hoveredId: null },
      ),

    register: (target) =>
      set((state) => {
        const existing = state.targets[target.id];
        // Returning the same state object short-circuits zustand's notify, so a
        // re-render that re-registers an unchanged row wakes nobody up.
        if (existing && isSameTarget(existing, target)) return state;
        const targets = { ...state.targets, [target.id]: target };

        // A pending reveal is waiting for exactly this: targets of its kind
        // mounting on the page it navigated to. Light each one up as it
        // arrives (capped), and let the shared timer close the burst.
        const pending = state.pendingReveal;
        if (pending && Date.now() - pending.requestedAt > PENDING_REVEAL_TTL_MS) {
          return { targets, pendingReveal: null };
        }
        if (
          pending &&
          pending.kind === target.kind &&
          state.revealedIds.size < REVEAL_MAX_TARGETS
        ) {
          armRevealTimer();
          const revealedIds = new Set(state.revealedIds);
          revealedIds.add(target.id);
          return { targets, revealedIds };
        }
        return { targets };
      }),

    unregister: (id) =>
      set((state) => {
        if (!(id in state.targets)) return state;
        const next = { ...state.targets };
        delete next[id];
        return { targets: next };
      }),

    pick: (target) =>
      set((state) => {
        if (state.picked.some((t) => t.id === target.id)) return state;
        return { picked: [...state.picked, target] };
      }),

    unpick: (id) =>
      set((state) => {
        if (!state.picked.some((t) => t.id === id)) return state;
        return { picked: state.picked.filter((t) => t.id !== id) };
      }),

    clearPicked: () =>
      set((state) => (state.picked.length === 0 ? state : { picked: [] })),

    requestReveal: ({ kind }) =>
      set((state) => {
        const matching = Object.values(state.targets)
          .filter((target) => target.kind === kind)
          .slice(0, REVEAL_MAX_TARGETS)
          .map((target) => target.id);
        if (matching.length > 0) {
          armRevealTimer();
          return { revealedIds: new Set(matching), pendingReveal: null };
        }
        // Nothing of that kind here — hold the ask for the page being
        // navigated to, where `register` will answer it.
        return { pendingReveal: { kind, requestedAt: Date.now() } };
      }),

    holdReveal: () => {
      // Only extends a reveal that is actually running — never starts one.
      if (revealTimer) armRevealTimer();
    },

    clearReveal: () =>
      set((state) => {
        if (state.revealedIds.size === 0 && state.pendingReveal === null) {
          return state;
        }
        return { revealedIds: new Set<string>(), pendingReveal: null };
      }),

    setActiveChipIds: (ids) =>
      set((state) => {
        const unchanged =
          ids.length === state.activeChipIds.size &&
          ids.every((id) => state.activeChipIds.has(id));
        if (unchanged) return state;
        return { activeChipIds: new Set(ids) };
      }),

    setProximity: ({ nearIds, hoveredId }) =>
      set((state) => {
        // Called on every animation frame the pointer moves. Bail on an
        // unchanged result so a mouse drifting across one row doesn't wake a
        // hundred subscribers sixty times a second.
        const sameNear =
          nearIds.length === state.nearIds.size &&
          nearIds.every((id) => state.nearIds.has(id));
        if (sameNear && hoveredId === state.hoveredId) return state;
        return { nearIds: new Set(nearIds), hoveredId };
      }),

    reset: () => {
      if (revealTimer) {
        clearTimeout(revealTimer);
        revealTimer = null;
      }
      set({
        targets: {},
        picked: [],
        activeChipIds: new Set<string>(),
        revealedIds: new Set<string>(),
        pendingReveal: null,
        nearIds: new Set<string>(),
        hoveredId: null,
        spotlightId: null,
        armSource: null,
      });
    },
  }),
);

/**
 * FOLLOW THE PANEL'S SCOPE.
 *
 * `picked` is the one slice here that deliberately outlives the DOM, which is
 * exactly what made it the one slice that leaked: a trace row clicked in project
 * A survived the project switch (the store is a module singleton), stayed in
 * `candidates` via `useLangyPageContext`, and was offered in project B's "+
 * context" menu — where choosing it would have sent another project's resource
 * ref to the agent.
 *
 * The dependency runs ONE WAY, and this is why it runs this way: this store
 * already knows about `langyStore` (absorbing writes a chip there), so it
 * REACTS to it. Having `langyStore` reach back in to clear the registry would
 * close the loop into a cycle, and would put "what else has to be forgotten"
 * in the store that has no idea any of this exists.
 *
 * Two events, two answers:
 *   the scope changed (user / organization / project) — everything goes,
 *     including the arm state and any reveal in flight. The page underneath is
 *     navigating away, so its targets re-register on arrival.
 *   a new conversation started — only the PICKS go. The registry describes what
 *     is mounted right now, and the rows are still on screen; clearing it would
 *     empty the `#` palette until they happened to remount.
 */
useLangyStore.subscribe((state, previous) => {
  if (state.activeConversationScope !== previous.activeConversationScope) {
    useLangyContextTargetStore.getState().reset();
    return;
  }
  if (state.conversationEpoch !== previous.conversationEpoch) {
    useLangyContextTargetStore.getState().clearPicked();
  }
});

/**
 * Take a page target into Langy's context — the one definition of what
 * "absorb" DOES, shared by the hover affordance, the target's own toggle, and
 * the composer's `#` palette.
 *
 * Two writes, and both matter: `pick` keeps the target's payload alive after the
 * element unmounts, and `chooseChip` is what actually puts it in context —
 * chips are opt-in, so a target that is only picked would sit in the "+ context"
 * menu and the click would look like it did nothing.
 */
export function absorbContextTarget(target: LangyContextTarget): void {
  useLangyContextTargetStore.getState().pick(target);
  // The flourish: the thing floods purple and drains, so taking something into
  // context is a moment on the page rather than a chip quietly appearing in a
  // composer the reader may not even be looking at.
  useLangyContextTargetStore.getState().flashAbsorb(target.id);
  useLangyStore.getState().chooseChip(target.id);
  // Doing the thing retires the hint that teaches it. Nobody needs to be told
  // how to do what they have just done.
  useLangyStore.getState().dismissContextHint();
}

/**
 * The reverse. Unpick AND dismiss — the chip showing might have been
 * derived from the route or the open drawer rather than picked, and unpicking
 * alone would leave it sitting in the composer. Dismissal is exactly what the
 * chip's own ✕ does.
 */
export function releaseContextTarget(id: string): void {
  useLangyContextTargetStore.getState().unpick(id);
  useLangyStore.getState().dismissChip(id);
}
