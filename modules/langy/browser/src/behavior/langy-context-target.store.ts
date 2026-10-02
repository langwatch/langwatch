import { defineSlice } from "@langwatch/browser-host/global-store";
import {
  LANGY_CONTEXT_DRAG_MIME,
  LANGY_CONTEXT_TARGET_SLICE,
  type LangyArmSource,
  type LangyContextTargetDescriptor,
  type LangyContextTargetState,
  type LangyRevealableKind,
} from "@langwatch/langy-contract";
import { nowInstant } from "@langwatch/time";

import { useLangyStore } from "./langy.store.ts";

export {
  LANGY_CONTEXT_DRAG_MIME,
  type LangyArmSource,
  type LangyContextTargetDescriptor,
  type LangyRevealableKind,
} from "@langwatch/langy-contract";

/**
 * The registry of things on the page Langy can take as context.
 */

/** Read a dragged target back off a drop event, or null if it isn't one. */
export function readDraggedTarget(
  transfer: DataTransfer | null,
): LangyContextTargetDescriptor | null {
  const raw = transfer?.getData(LANGY_CONTEXT_DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const candidate = parsed as LangyContextTargetDescriptor | null;
    const isTarget =
      typeof candidate === "object" &&
      candidate !== null &&
      typeof candidate.id === "string" &&
      typeof candidate.label === "string";
    if (isTarget) return candidate;
  } catch {
    // Another app's drag that happens to claim our MIME. Not ours; ignore it.
  }
  return null;
}

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

/** Same id AND same payload — a re-register with identical content is a no-op. */
function isSameTarget(a: LangyContextTargetDescriptor, b: LangyContextTargetDescriptor): boolean {
  return a.kind === b.kind && a.label === b.label && a.ref === b.ref;
}

function disarmed(
  state: LangyContextTargetState,
  source: LangyArmSource | undefined,
): Partial<LangyContextTargetState> {
  if (state.armSource === null) return state;
  // A disarm for a source that is not the one holding the latch is not a
  // release — it is a different gesture ending.
  if (source && state.armSource !== source) return state;
  return {
    armSource: null,
    nearIds: new Set<string>(),
    hoveredId: null,
  };
}

function registered(
  state: LangyContextTargetState,
  target: LangyContextTargetDescriptor,
): Partial<LangyContextTargetState> {
  const existing = state.targets[target.id];
  // Returning the same state object short-circuits zustand's notify, so a
  // re-render that re-registers an unchanged row wakes nobody up.
  if (existing && isSameTarget(existing, target)) return state;
  const targets = { ...state.targets, [target.id]: target };

  // A pending reveal is waiting for exactly this: targets of its kind
  // mounting on the page it navigated to. Light each one up as it
  // arrives (capped), and let the shared timer close the burst.
  const pending = state.pendingReveal;
  if (pending && nowInstant().epochMilliseconds - pending.requestedAt > PENDING_REVEAL_TTL_MS) {
    return { targets, pendingReveal: null };
  }
  if (pending && pending.kind === target.kind && state.revealedIds.size < REVEAL_MAX_TARGETS) {
    armRevealTimer();
    const revealedIds = new Set(state.revealedIds);
    revealedIds.add(target.id);
    return { targets, revealedIds };
  }
  return { targets };
}

function unregistered(
  state: LangyContextTargetState,
  id: string,
): Partial<LangyContextTargetState> {
  if (!(id in state.targets)) return state;
  const next = { ...state.targets };
  delete next[id];
  return { targets: next };
}

function picked(
  state: LangyContextTargetState,
  target: LangyContextTargetDescriptor,
): Partial<LangyContextTargetState> {
  if (state.picked.some((t) => t.id === target.id)) return state;
  return { picked: [...state.picked, target] };
}

function unpicked(state: LangyContextTargetState, id: string): Partial<LangyContextTargetState> {
  if (!state.picked.some((t) => t.id === id)) return state;
  return { picked: state.picked.filter((t) => t.id !== id) };
}

function revealRequested(
  state: LangyContextTargetState,
  { kind }: { kind: LangyRevealableKind },
): Partial<LangyContextTargetState> {
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
  return { pendingReveal: { kind, requestedAt: nowInstant().epochMilliseconds } };
}

function revealCleared(state: LangyContextTargetState): Partial<LangyContextTargetState> {
  if (state.revealedIds.size === 0 && state.pendingReveal === null) {
    return state;
  }
  return { revealedIds: new Set<string>(), pendingReveal: null };
}

function withActiveChipIds(
  state: LangyContextTargetState,
  ids: string[],
): Partial<LangyContextTargetState> {
  const unchanged =
    ids.length === state.activeChipIds.size && ids.every((id) => state.activeChipIds.has(id));
  if (unchanged) return state;
  return { activeChipIds: new Set(ids) };
}

function withProximity(
  state: LangyContextTargetState,
  { nearIds, hoveredId }: { nearIds: string[]; hoveredId: string | null },
): Partial<LangyContextTargetState> {
  // Called on every animation frame the pointer moves. Bail on an
  // unchanged result so a mouse drifting across one row doesn't wake a
  // hundred subscribers sixty times a second.
  const sameNear =
    nearIds.length === state.nearIds.size && nearIds.every((id) => state.nearIds.has(id));
  if (sameNear && hoveredId === state.hoveredId) return state;
  return { nearIds: new Set(nearIds), hoveredId };
}

function armToggled(state: LangyContextTargetState): Partial<LangyContextTargetState> {
  return state.armSource === null
    ? { armSource: "key" as const }
    : { armSource: null, nearIds: new Set<string>(), hoveredId: null };
}

function absorbFlashed(
  state: LangyContextTargetState,
  id: string,
): Partial<LangyContextTargetState> {
  return {
    absorbFlash: { id, nonce: (state.absorbFlash?.nonce ?? 0) + 1 },
  };
}

function absorbFlashCleared(
  state: LangyContextTargetState,
  nonce: number,
): Partial<LangyContextTargetState> {
  return state.absorbFlash?.nonce === nonce ? { absorbFlash: null } : state;
}

function spotlit(
  state: LangyContextTargetState,
  id: string | null,
): Partial<LangyContextTargetState> {
  return state.spotlightId === id ? state : { spotlightId: id };
}

export const useLangyContextTargetStore = defineSlice<LangyContextTargetState>({
  name: LANGY_CONTEXT_TARGET_SLICE,
  create: (set) => ({
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

    setSpotlight: (id) => set((state) => spotlit(state, id)),

    flashAbsorb: (id) => set((state) => absorbFlashed(state, id)),

    clearAbsorbFlash: (nonce) => set((state) => absorbFlashCleared(state, nonce)),

    arm: (source) => set((state) => (state.armSource === source ? state : { armSource: source })),

    disarm: (source) => set((state) => disarmed(state, source)),

    toggleArm: () => set((state) => armToggled(state)),

    register: (target) => set((state) => registered(state, target)),

    unregister: (id) => set((state) => unregistered(state, id)),

    pick: (target) => set((state) => picked(state, target)),

    unpick: (id) => set((state) => unpicked(state, id)),

    clearPicked: () => set((state) => (state.picked.length === 0 ? state : { picked: [] })),

    requestReveal: ({ kind }) => set((state) => revealRequested(state, { kind })),

    holdReveal: () => {
      // Only extends a reveal that is actually running — never starts one.
      if (revealTimer) armRevealTimer();
    },

    clearReveal: () => set((state) => revealCleared(state)),

    setActiveChipIds: (ids) => set((state) => withActiveChipIds(state, ids)),

    setProximity: ({ nearIds, hoveredId }) =>
      set((state) => withProximity(state, { nearIds, hoveredId })),

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
});

/**
 * FOLLOW THE PANEL'S SCOPE.
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
 * Take a page target into Langy's context — the one definition of what "absorb" DOES,
 * shared by the hover affordance, the target's own toggle, and the composer's `#`
 * palette.
 */
export function absorbContextTarget(target: LangyContextTargetDescriptor): void {
  useLangyContextTargetStore.getState().pick(target);
  // The flourish: the thing floods purple and drains, so taking something into
  // context is a moment on the page rather than a chip quietly appearing in a
  // composer the reader may not even be looking at.
  useLangyContextTargetStore.getState().flashAbsorb(target.id);
  useLangyStore.getState().chooseChip(target.id);
}

/**
 * The reverse. Unpick AND dismiss — the chip showing might have been derived from the
 * route or the open drawer rather than picked, and unpicking alone would leave it
 * sitting in the composer. Dismissal is exactly what the chip's own ✕ does.
 */
export function releaseContextTarget(id: string): void {
  useLangyContextTargetStore.getState().unpick(id);
  useLangyStore.getState().dismissChip(id);
}

/**
 * The composer's ✕, which is the ONE remove affordance for context. A chip can
 * be page-derived, explicitly attached, or both, so removal clears every source
 * it has — otherwise it reappears from the other one.
 */
export function removeContextChip(id: string): void {
  const langy = useLangyStore.getState();
  if (langy.attachedContext.some((attached) => attached.id === id)) {
    langy.detachContext(id);
  }
  langy.dismissChip(id);
}
