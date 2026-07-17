import { create } from "zustand";
import { useLangyStore, type LangyContextChip } from "./langyStore";

/**
 * The registry of things on the page Langy can take as context.
 *
 * A "target" is any object a component declares itself to be — a trace row, a
 * trace drawer, an online evaluation card, an experiment row. Components opt in
 * with `useLangyContextTarget`, which registers them here while mounted and
 * de-registers on unmount. While the Langy panel is open, a registered target
 * grows a subtle gradient ring and can be clicked to ride along as a composer
 * context chip.
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
 * The kinds the composer's `#` palette can ask to see on the page ("show me the
 * traces here") or be taken to ("browse datasets"). A subset of the chip kinds:
 * `selection` and `filter` describe table STATE, not registrable page objects,
 * and `project` / `dashboard` have no glowing element to reveal.
 */
export type LangyRevealableKind = Extract<
  LangyContextTarget["kind"],
  "trace" | "dataset" | "prompt" | "evaluation" | "scenario" | "experiment"
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
      });
    },
  }),
);

/**
 * Take a page target into Langy's context — the one definition of what
 * "absorb" DOES, shared by the hover affordance, the target's own toggle, and
 * the composer's `#` palette.
 *
 * Two writes, and both matter: `pick` is what makes it a chip, `restoreChip`
 * lifts any earlier dismissal so re-adding a chip you removed actually shows it
 * again instead of silently hitting the dismissal list.
 */
export function absorbContextTarget(target: LangyContextTarget): void {
  useLangyContextTargetStore.getState().pick(target);
  useLangyStore.getState().restoreChip(target.id);
}

/**
 * The reverse. Unpick AND dismiss — the chip showing might have been
 * auto-derived from the route rather than picked, and unpicking alone would
 * leave it sitting in the composer, making the click look like it did nothing.
 * Dismissal is exactly what the chip's own ✕ does.
 */
export function releaseContextTarget(id: string): void {
  useLangyContextTargetStore.getState().unpick(id);
  useLangyStore.getState().dismissChip(id);
}
