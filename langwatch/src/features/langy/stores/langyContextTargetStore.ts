import { create } from "zustand";
import type { LangyContextChip } from "./langyStore";

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

interface LangyContextTargetState {
  /** Targets mounted on the page right now, keyed by their stable chip id. */
  targets: Record<string, LangyContextTarget>;
  /** Targets the user clicked, in click order. Survives the target unmounting. */
  picked: LangyContextTarget[];
  /** Chip ids the composer is currently showing (auto-derived + picked). */
  activeChipIds: Set<string>;

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
    nearIds: new Set<string>(),
    hoveredId: null,

    register: (target) =>
      set((state) => {
        const existing = state.targets[target.id];
        // Returning the same state object short-circuits zustand's notify, so a
        // re-render that re-registers an unchanged row wakes nobody up.
        if (existing && isSameTarget(existing, target)) return state;
        return { targets: { ...state.targets, [target.id]: target } };
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

    reset: () =>
      set({
        targets: {},
        picked: [],
        activeChipIds: new Set<string>(),
        nearIds: new Set<string>(),
        hoveredId: null,
      }),
  }),
);
