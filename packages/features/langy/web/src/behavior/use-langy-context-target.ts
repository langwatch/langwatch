import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo } from "react";
import "./langy-context-target.css";
import {
  absorbContextTarget,
  LANGY_CONTEXT_DRAG_MIME,
  type LangyContextTarget,
  releaseContextTarget,
  useLangyContextTargetStore,
} from "./langy-context-target.store";

/**
 * Declare "I am a thing Langy can take as context".
 */
export interface LangyContextTargetProps {
  className?: string;
  style?: CSSProperties;
  /**
   * The layer finds targets by this attribute — no ref, so it never fights the
   * virtualizer (which already owns the trace row's ref).
   */
  "data-langy-target"?: string;
  /** Drives the whole visual: `near` | `hover` | `added`. Absent = invisible. */
  "data-langy-target-state"?: LangyTargetVisualState;
  /** Only while the target is OFFERED (armed, or briefly revealed). Off
   *  otherwise, or every row on the page would become draggable the moment the
   *  panel opened. */
  draggable?: boolean;
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  /**
   * Only while the target is offered — and capture, deliberately. Offered, a click
   * means "add this", so it has to be taken before the row's own handler opens a
   * drawer.
   */
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
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

  // NOT gated on the panel being open.
  const isActive = enabled && !!id && !!kind && !!label;

  const register = useLangyContextTargetStore((state) => state.register);
  const unregister = useLangyContextTargetStore((state) => state.unregister);

  // "Added" means the composer is actually SHOWING this chip — which covers the ones
  // Langy auto-derived from the route / open drawer, not just the ones the user picked.
  const isAdded = useLangyContextTargetStore((state) =>
    isActive && id ? state.activeChipIds.has(id) : false,
  );
  // Lit by request rather than by the pointer — the composer's `#trace` →
  // "Show traces on this page" gesture. A brief, self-ending arm: same ring,
  // same click, same drag, released by a timer instead of a keystroke.
  const isRevealed = useLangyContextTargetStore((state) =>
    isActive && id ? state.revealedIds.has(id) : false,
  );
  const isArmed = useLangyContextTargetStore((state) => state.armSource !== null);
  const isHovered = useLangyContextTargetStore((state) =>
    isActive && id ? state.hoveredId === id : false,
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

  const onDragStart = useCallback(
    (event: DragEvent<HTMLElement>) => {
      if (!id || !kind || !label) return;
      event.dataTransfer.setData(
        LANGY_CONTEXT_DRAG_MIME,
        JSON.stringify({ id, kind, label, ref: chipRef }),
      );
      // A plain-text fallback so dropping into the composer's textarea — which
      // people will try — leaves the label behind rather than nothing at all.
      event.dataTransfer.setData("text/plain", label);
      event.dataTransfer.effectAllowed = "copy";
    },
    [id, kind, label, chipRef],
  );

  const onClickCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      toggle();
    },
    [toggle],
  );

  // Armed OR revealed: the target is being OFFERED, and an offer the user can
  // see has to be an offer they can take. The two differ only in what ends them
  // — a keystroke, or a timer.
  const isOffered = isArmed || isRevealed;

  const targetProps = useMemo<LangyContextTargetProps>(() => {
    if (!isActive || !id) return NO_PROPS;
    // Not offered, the page is the page: no ring, no drag, no intercepted
    // click. Only the locating id, which nothing paints and nothing listens to
    // — see the ZERO COST note above for why it cannot wait for arming.
    if (!isOffered) return { "data-langy-target": id };
    return {
      className: "langy-target",
      style: shimmerStyleFor(id),
      "data-langy-target": id,
      // Offered, EVERY target lights up — the point of the mode is to answer
      // "what can I even give it?" at a glance. That is the christmas tree the
      // earlier always-on design was right to refuse; what makes it fine here
      // is that it is modal, brief, and asked for.
      "data-langy-target-state": visualState({
        isAdded,
        isHovered,
        isNear: true,
      }),
      draggable: true,
      onDragStart,
      onClickCapture,
    };
  }, [isActive, id, isOffered, isAdded, isHovered, onDragStart, onClickCapture]);

  return { targetProps, isActive, isAdded, toggle };
}

/**
 * The shimmer's phase offset, and it is load-bearing: it is the whole difference
 * between a shimmer FIELD and a rainbow barcode.
 */
function shimmerStyleFor(id: string): CSSProperties {
  return {
    "--langy-target-delay": `-${shimmerPhaseFor(id)}ms`,
  } as CSSProperties;
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
