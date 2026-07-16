import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo } from "react";
import "../langyContextTarget.css";
import {
  absorbContextTarget,
  type LangyContextTarget,
  releaseContextTarget,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";
import { useLangyStore } from "../stores/langyStore";

/**
 * Declare "I am a thing Langy can take as context".
 *
 * Prefer the `<LangyContextTarget>` COMPONENT over this hook — it can be used
 * inline inside a `.map()`, where a hook cannot. Reach for the hook directly
 * only when the target's root is a component you already own and you'd rather
 * spread props than nest an element (the trace table's virtualized row does
 * exactly this: its root is a <tbody> the virtualizer measures).
 *
 * HOW IT BEHAVES, and every clause here is a correction of an earlier cut:
 *
 *   It does NOT touch the click. A trace row still opens its drawer, a card
 *   still opens its editor, with Langy open or closed. The first version
 *   swallowed the click in the capture phase to add the target to context, and
 *   that made every row on the page un-openable the moment the panel opened —
 *   the page stopped being the page. Adding to context is now an EXPLICIT act
 *   on an explicit control (see below), never an ambush on an existing gesture.
 *
 *   Targets don't all light up at once. They light up AROUND THE CURSOR:
 *   `LangyContextTargetLayer` tracks the pointer and marks what's near it. A
 *   page-wide christmas tree of shimmering outlines is exactly the "over the
 *   top" failure this design keeps walking back from. What you get instead is a
 *   quiet field that follows your hand.
 *
 *   The affordance is a real button, rendered ONCE for the whole page in a
 *   portal by the layer, floated over whichever target you're hovering. Not a
 *   pseudo-element and not a node inside the target — on a <tbody> either one
 *   generates an anonymous table box and breaks the row's geometry, which is
 *   precisely what broke the trace table's expanded rows.
 *
 * ZERO COST WHEN LANGY IS CLOSED, and that is a hard requirement, not a nicety:
 *   - `targetProps` is a frozen empty object: no className (no CSS rule can
 *     match), no data attributes, no inline style, no handlers.
 *   - the registration effect early-returns, so the store stays empty.
 *   - the layer renders null and attaches no pointer listeners at all.
 *   - the highlight is an `outline` / inset shadow, both defined never to affect
 *     layout — so even when it IS on, nothing on the page moves by a pixel.
 * The one residual cost is a zustand subscription per target whose selectors
 * return booleans: they re-run on store writes and re-render on almost none.
 *
 * Pass `null` to opt out without breaking the rules of hooks (a skeleton row, a
 * drawer with no trace loaded yet).
 */
export interface LangyContextTargetProps {
  className?: string;
  style?: CSSProperties;
  /** The layer finds targets by this attribute — no ref, so it never fights the
   *  virtualizer (which already owns the trace row's ref). */
  "data-langy-target"?: string;
  /** Drives the whole visual: `near` | `hover` | `added`. Absent = invisible. */
  "data-langy-target-state"?: LangyTargetVisualState;
}

export type LangyTargetVisualState = "near" | "hover" | "added";

export interface LangyContextTargetHandle {
  /** Spread onto the target's root element. Empty when Langy is closed. */
  targetProps: LangyContextTargetProps;
  /** Langy is open and this target is live. */
  isActive: boolean;
  /** This target's chip is currently in the composer. */
  isAdded: boolean;
  /** Add / remove this target's chip. The layer's button calls this. */
  toggle: () => void;
}

/**
 * Must match the `langy-target-shimmer` duration in the stylesheet — a phase
 * offset only spreads targets evenly if it spans exactly one full period.
 */
const SHIMMER_PERIOD_MS = 11000;

const NO_PROPS: LangyContextTargetProps = Object.freeze({});

export function useLangyContextTarget(
  target: (LangyContextTarget & { enabled?: boolean }) | null | undefined,
): LangyContextTargetHandle {
  // Destructure to primitives up front: call sites pass a fresh object literal
  // on every render, so depending on the object itself would re-register the
  // target on every render of every row.
  const id = target?.id;
  const kind = target?.kind;
  const label = target?.label;
  const chipRef = target?.ref;
  const enabled = target?.enabled ?? true;

  const isOpen = useLangyStore((state) => state.isOpen);
  const isActive = isOpen && enabled && !!id && !!kind && !!label;

  const register = useLangyContextTargetStore((state) => state.register);
  const unregister = useLangyContextTargetStore((state) => state.unregister);

  // "Added" means the composer is actually SHOWING this chip — which covers the
  // ones Langy auto-derived from the route / open drawer, not just the ones the
  // user picked. So the trace you already have open reads as added instead of
  // inviting you to add it a second time.
  //
  // All three selectors return booleans, so the store's churn (rows mounting as
  // you scroll, proximity recomputing as the pointer moves) re-renders only the
  // handful of targets whose answer actually changed.
  const isAdded = useLangyContextTargetStore((state) =>
    isActive && id ? state.activeChipIds.has(id) : false,
  );
  // Lit by request rather than by the pointer — the composer's `#trace` →
  // "Show traces on this page" gesture. Reads exactly like `near`.
  const isRevealed = useLangyContextTargetStore((state) =>
    isActive && id ? state.revealedIds.has(id) : false,
  );

  useEffect(() => {
    if (!isActive || !id || !kind || !label) return;
    register({ id, kind, label, ref: chipRef });
    return () => unregister(id);
  }, [isActive, id, kind, label, chipRef, register, unregister]);

  const toggle = useCallback(() => {
    if (!id || !kind || !label) return;
    const targets = useLangyContextTargetStore.getState();
    if (targets.activeChipIds.has(id)) {
      releaseContextTarget(id);
    } else {
      absorbContextTarget({ id, kind, label, ref: chipRef });
    }
  }, [id, kind, label, chipRef]);

  const targetProps = useMemo<LangyContextTargetProps>(() => {
    if (!isActive || !id) return NO_PROPS;
    return {
      className: "langy-target",
      // The phase offset, and it is load-bearing: it is the whole difference
      // between a shimmer FIELD and a rainbow barcode. Targets sharing one
      // animation start on the same frame and drift in lockstep; hashed per id,
      // they drift out of phase, like light moving on water. Stable across
      // renders, so the shimmer never restarts mid-cycle.
      style: {
        "--langy-target-delay": `-${shimmerPhaseFor(id)}ms`,
      } as CSSProperties,
      "data-langy-target": id,
      // Context is now derived from the view, selection and open drawer. Do not
      // paint persistent rings through cards or place controls over the page.
      // A deliberate `#trace` reveal may still point out eligible resources.
      "data-langy-target-state": isRevealed ? "near" : undefined,
    };
  }, [isActive, id, isRevealed]);

  return { targetProps, isActive, isAdded, toggle };
}

/**
 * Added beats hovered beats near. An added target stays lit even when the
 * pointer is nowhere near it — that's the point: with Langy open you can see at
 * a glance everything it already has, without hunting for it.
 */
function visualState({
  isAdded,
  isHovered,
  isNear,
}: {
  isAdded: boolean;
  isHovered: boolean;
  isNear: boolean;
}): LangyTargetVisualState | undefined {
  if (isAdded) return "added";
  if (isHovered) return "hover";
  if (isNear) return "near";
  return undefined;
}

/** A stable 0..SHIMMER_PERIOD_MS offset derived from the target id. */
function shimmerPhaseFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SHIMMER_PERIOD_MS;
}
