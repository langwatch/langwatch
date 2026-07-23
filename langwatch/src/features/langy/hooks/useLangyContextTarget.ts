import type { CSSProperties, DragEvent, MouseEvent } from "react";
import { useCallback, useEffect, useMemo } from "react";
import "../langyContextTarget.css";
import {
  absorbContextTarget,
  LANGY_CONTEXT_DRAG_MIME,
  type LangyContextTarget,
  releaseContextTarget,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";

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
 *   Nothing happens until the page is ARMED — `#`, or a held Shift; see
 *   `useLangyContextArming`. That gate is the correction. The first version
 *   swallowed clicks in the capture phase whenever the panel was open, and that
 *   made every row on the page un-openable the moment you asked Langy a
 *   question — the page stopped being the page. The version after it went the
 *   other way and painted nothing ever, which made the whole mechanism
 *   undiscoverable. A mode fixes both: outside it a trace row opens its drawer
 *   exactly as it always did; inside it, a click means "give this to Langy",
 *   the page says so, and one keystroke ends it.
 *
 *   Armed, targets light up and can be clicked OR dragged onto the panel. The
 *   affordance button is also a real button, rendered ONCE for the whole page in
 *   a portal by the layer, floated over whichever target you're hovering. Not a
 *   pseudo-element and not a node inside the target — on a <tbody> either one
 *   generates an anonymous table box and breaks the row's geometry, which is
 *   precisely what broke the trace table's expanded rows.
 *
 *   A REVEAL (`#trace` → "Show traces on this page") is the same offer, made
 *   briefly and by request rather than held open by a mode. It therefore carries
 *   the same behaviour: a revealed target lights up, can be clicked or dragged
 *   into context, and gets the same floating button. It used to light up and do
 *   nothing, which made the palette's own promise — "anything that lights up can
 *   be added as context" — a lie for the 2.6s it was on screen.
 *
 * ZERO COST WHEN DISARMED, and that is a hard requirement, not a nicety. The
 * property being preserved is precisely: NOTHING THE USER CAN SEE OR CLICK.
 *   - `targetProps` carries no className (so no CSS rule can match), no visual
 *     state attribute, no inline style, no handlers, and is not draggable.
 *   - the ONE thing it does carry once the target is registered is
 *     `data-langy-target` — an id, invisible, inert, matched by no stylesheet
 *     rule and by no listener. It is how the panel finds the element it is
 *     pointing at: hovering a context chip in the composer shines a light on the
 *     card it names, and that is not the picking mode, it is reading the list
 *     you already have. Locating an element cannot depend on the user first
 *     arming the page, or the spotlight can never fire.
 *   - with Langy closed the registration effect early-returns too, so the store
 *     stays empty, the attribute is absent, and the layer attaches no listeners.
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
  /**
   * The layer finds targets by this attribute — no ref, so it never fights the
   * virtualizer (which already owns the trace row's ref). Present for as long as
   * the target is REGISTERED, which is wider than "lit": the panel → page
   * spotlight has to be able to find a card the user has not armed the page for.
   * Inert on its own — no rule in the stylesheet matches it.
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
   * Only while the target is offered — and capture, deliberately. Offered, a
   * click means "add this", so it has to be taken before the row's own handler
   * opens a drawer. Outside that the prop is absent and the element behaves
   * exactly as it did before Langy existed.
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

  // NOT gated on the panel being open. The arming gesture works whether Langy
  // is open, peeking or shut (see LangyContextTargetLayer), and half of that
  // fix is worthless without this half: with the panel closed the page armed,
  // said "click anything highlighted", and then registered no targets at all —
  // so the mode announced itself over a page where nothing could light up and
  // nothing could be clicked. You reach for something on the page BEFORE you
  // go and talk about it, which is exactly when the panel is not open.
  const isActive = enabled && !!id && !!kind && !!label;

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
 * between a shimmer FIELD and a rainbow barcode. Targets sharing one animation
 * start on the same frame and drift in lockstep; hashed per id, they drift out
 * of phase, like light moving on water. Stable across renders, so the shimmer
 * never restarts mid-cycle.
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
