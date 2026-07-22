import { chakra } from "@chakra-ui/react";
import { Check, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../langyContextTarget.css";
import { useLangyContextArming } from "../hooks/useLangyContextArming";
import {
  absorbContextTarget,
  releaseContextTarget,
  useLangyContextTargetStore,
} from "../stores/langyContextTargetStore";
import { useLangyStore } from "../stores/langyStore";

/**
 * The one moving part behind "point at things and add them to Langy". Mounted
 * once, next to the panel.
 *
 * It does two jobs, and does them for EVERY target on the page from a single
 * place — which is the whole reason it exists:
 *
 *  1. PROXIMITY. It follows the pointer and works out which registered targets
 *     are near it and which one is under it, and writes that to the store.
 *     Targets read booleans off it and light up accordingly, so the page shows
 *     a quiet field of outlines around your hand instead of lighting up
 *     everything at once.
 *
 *  2. THE AFFORDANCE. It renders ONE button — "Absorb context" / "Absorbed" —
 *     in a portal, floated over whichever target you're hovering. One node for
 *     the whole page, not one per row. That matters for more than bookkeeping:
 *     a button rendered INSIDE a target would have to live inside a <tbody>,
 *     where any generated box gets wrapped in an anonymous table row and wrecks
 *     the row's geometry. A fixed-position portal touches nothing.
 *
 * Both jobs are gated on the page OFFERING its targets, which is two states, not
 * one: ARMED — `#` or a held Shift, see `useLangyContextArming` — or REVEALED,
 * the brief `#trace` → "Show traces on this page" glow. Both light targets up
 * and both make them clickable, so both need the pointer layer; a reveal that
 * lit rows the button never appeared over made the palette's own promise
 * ("anything that lights up can be added as context") untrue.
 *
 * With Langy merely open, this attaches one keydown listener and renders
 * nothing; with Langy closed it does not even do that. The pointer tracking, the
 * measurement and the button only exist inside a mode the user asked for.
 */

/** How close the pointer has to get before a target admits it exists (px). */
const PROXIMITY_PX = 140;

interface TargetRect {
  id: string;
  rect: DOMRect;
}

/**
 * Marks the layer's OWN floating chrome. The pointer resting on the "Absorb
 * context" button must not read as "the pointer left the target" — the button
 * is drawn in a portal on top of it, so a naive hit test finds the button, not
 * the row, and the thing you are reaching for unmounts as you reach for it.
 */
const OVERLAY_ATTR = "data-langy-overlay";

/**
 * Subtrees the page has taken out of play. Ark/Chakra mark everything behind an
 * open modal drawer or dialog `aria-hidden` / `inert`, which is exactly the
 * "don't offer this" signal we want — a row sitting under a drawer must not
 * glow, and must not be absorbable, through the thing covering it.
 */
const OCCLUDED_SELECTOR = '[aria-hidden="true"], [inert]';

/** Is this target genuinely available to the pointer right now? */
function isReachable(element: HTMLElement): boolean {
  if (element.closest(OCCLUDED_SELECTOR)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function LangyContextTargetLayer() {
  const isOpen = useLangyStore((state) => state.isOpen);
  return (
    <>
      {/* ALWAYS armable, whether the panel is open, peeking or shut.

          This whole subtree used to sit behind `isOpen`, which meant the
          arming listener itself was never attached unless Langy was already
          open — so holding Shift anywhere else did nothing at all, silently.
          That was always wrong (you reach for something on the page BEFORE
          you go and talk about it) and the peek made it wrong most of the
          time, since a minimised panel reads as closed.

          Nothing expensive rides on this: `ArmableLayer` is one keydown
          listener until the user actually arms, and the pointer tracking and
          measurement stay behind that gate. */}
      <ArmableLayer />
      {/* Panel → page, so this one genuinely does need the panel: it lights
          the card for whichever chip in the open list is under the pointer.
          Outside the ARMED gate on purpose, though — reading the list you
          already have is not the picking mode. */}
      {isOpen ? <SpotlightLayer /> : null}
    </>
  );
}

/**
 * Panel → page. The user runs their eye down the context list; whichever chip
 * is under the pointer, its card lights up where it actually sits.
 *
 * Drawn as an overlay rather than by handing the target another visual state,
 * for two reasons that both matter. The ring the targets paint themselves is
 * suppressed on table rows (a sticky first column paints over an ancestor's
 * outline — see the stylesheet), so a row could not answer this at all. And the
 * spotlight has to be legible at a glance from across the page, which is a
 * different job from the deliberately-barely-there proximity field.
 */
function SpotlightLayer() {
  const spotlightId = useLangyContextTargetStore((s) => s.spotlightId);
  if (!spotlightId) return null;
  return <TargetSpotlight targetId={spotlightId} />;
}

/** Follows the element: its box, and its own corners. */
function TargetSpotlight({ targetId }: { targetId: string }) {
  const [box, setBox] = useState<{ rect: DOMRect; radius: string } | null>(
    null,
  );

  useEffect(() => {
    const element = document.querySelector<HTMLElement>(
      `[data-langy-target="${CSS.escape(targetId)}"]`,
    );
    if (!element) {
      setBox(null);
      return;
    }
    // The element's OWN radius, read rather than guessed: a squared-off glow
    // around a rounded card is the tell that something is drawn on top of the
    // page instead of belonging to it.
    const radius = getComputedStyle(element).borderRadius || "0px";
    const track = () =>
      setBox({ rect: element.getBoundingClientRect(), radius });
    track();

    window.addEventListener("scroll", track, { passive: true, capture: true });
    window.addEventListener("resize", track, { passive: true });
    return () => {
      window.removeEventListener("scroll", track, { capture: true });
      window.removeEventListener("resize", track);
    };
  }, [targetId]);

  if (!box || typeof document === "undefined") return null;

  return createPortal(
    <chakra.div
      className="langy-target-spotlight"
      data-testid="langy-target-spotlight"
      aria-hidden
      position="fixed"
      top={`${box.rect.top}px`}
      left={`${box.rect.left}px`}
      width={`${box.rect.width}px`}
      height={`${box.rect.height}px`}
      borderRadius={box.radius}
      // Never in the way: this is a light shone on the page, not a surface.
      pointerEvents="none"
      zIndex={1249}
    />,
    document.body,
  );
}

/**
 * Open, but idle. All this does is listen for the arming gesture — one keydown
 * handler, no pointer tracking, no measurement, nothing rendered. The page is
 * untouched until the user asks for it.
 *
 * A REVEAL counts as asking for it. `#trace` → "Show traces on this page" lights
 * targets up and makes them clickable for a couple of seconds; without the
 * pointer layer running they would light up and answer to nothing — no hover
 * state, and no button over the row the user is pointing at.
 */
function ArmableLayer() {
  useLangyContextArming();
  const armed = useLangyContextTargetStore((s) => s.armSource !== null);
  const revealing = useLangyContextTargetStore((s) => s.revealedIds.size > 0);
  if (!armed && !revealing) return null;
  return (
    <>
      <ActiveLayer />
      <OfferHint />
    </>
  );
}

/** The hint's resting distance from the bottom edge. */
const HINT_BOTTOM_PX = 20;
/** Breathing room between the hint and a bar it has to sit above. */
const HINT_BAR_GAP_PX = 8;

/**
 * How far up the hint must move to clear whatever else floats at the
 * bottom-center — the selection action bars (`data-bottom-floating-bar`, see
 * `SelectionActionBar`). The collision is not hypothetical: Shift is BOTH the
 * range-select modifier and the arm gesture, so the armed hint and the "N
 * selected" bar routinely exist at the same moment, in the same spot, and the
 * hint used to land straight on top of the bar's buttons.
 *
 * Measured, not guessed: the bars differ in height and offset, so the hint
 * clears the tallest one actually mounted. Watches the DOM while the hint is
 * up (bars mount as selections are made mid-arm) — cheap, because the hint
 * only exists inside the brief armed/revealed mode.
 */
function useBottomBarLift(): number {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    const measure = () => {
      let needed = 0;
      const bars = document.querySelectorAll<HTMLElement>(
        "[data-bottom-floating-bar]",
      );
      for (const bar of bars) {
        const rect = bar.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const clearance =
          window.innerHeight - rect.top + HINT_BAR_GAP_PX - HINT_BOTTOM_PX;
        needed = Math.max(needed, clearance);
      }
      setLift((previous) => (previous === needed ? previous : needed));
    };
    measure();

    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", measure, { passive: true });
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  return lift;
}

/**
 * The mode indicator. A mode you cannot see is a trap — the page suddenly
 * intercepting clicks with no explanation is exactly how a feature earns a bug
 * report — so while targets are being offered there is always one line saying
 * what is happening and how it ends. A reveal ends by itself, which is the only
 * thing that changes between the two.
 */
function OfferHint() {
  const source = useLangyContextTargetStore((s) => s.armSource);
  const lift = useBottomBarLift();
  if (typeof document === "undefined") return null;
  return createPortal(
    <chakra.div
      className="langy-armed-hint"
      data-testid="langy-armed-hint"
      position="fixed"
      bottom={`${HINT_BOTTOM_PX + lift}px`}
      left="50%"
      transform="translateX(-50%)"
      zIndex={1250}
      display="inline-flex"
      alignItems="center"
      gap={2}
      paddingX={3}
      paddingY={1.5}
      borderRadius="full"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="purple.emphasized"
      background="bg.panel"
      color="fg.muted"
      boxShadow="md"
      textStyle="xs"
      pointerEvents="none"
      whiteSpace="nowrap"
    >
      <Sparkles size={12} />
      Click anything highlighted to give it to Langy
      <chakra.span color="fg.subtle">
        {source === null
          ? "these fade in a moment"
          : source === "hold"
            ? "release Shift to stop"
            : "# or Esc to stop"}
      </chakra.span>
    </chakra.div>,
    document.body,
  );
}

function ActiveLayer() {
  const setProximity = useLangyContextTargetStore((s) => s.setProximity);
  const hoveredId = useLangyContextTargetStore((s) => s.hoveredId);

  // Rect cache. Reading ~30 bounding rects on every pointer move would force a
  // layout flush per frame; instead we measure once and re-measure only when
  // the geometry can actually have changed — targets mounting/unmounting (the
  // virtualizer), scroll, resize. Pointer moves then cost pure arithmetic.
  const rectsRef = useRef<TargetRect[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const elements = document.querySelectorAll<HTMLElement>(
      "[data-langy-target]",
    );
    const rects: TargetRect[] = [];
    for (const element of elements) {
      const id = element.dataset.langyTarget;
      if (!id) continue;
      // A row behind an open drawer is still in the DOM, still registered, and
      // still has a perfectly good rect. Dropping it here is what stops the
      // page glowing THROUGH whatever is covering it.
      if (!isReachable(element)) continue;
      rects.push({ id, rect: element.getBoundingClientRect() });
    }
    rectsRef.current = rects;
  }, []);

  const resolve = useCallback(() => {
    frameRef.current = null;
    const pointer = pointerRef.current;
    if (!pointer) {
      setProximity({ nearIds: [], hoveredId: null });
      return;
    }

    // Which target is under the pointer is a HIT TEST, not an arithmetic
    // question. Rect maths alone cannot see a drawer, a dialog, the Langy panel
    // itself, or a sticky header — it happily reports a row the user physically
    // cannot touch, and the affordance then floats over the covering surface
    // offering to absorb something behind it. `elementFromPoint` answers with
    // whatever is actually on top, which is the only honest answer.
    const hit = document.elementFromPoint(pointer.x, pointer.y);
    // Our own floating button counts as "still on the target" — see OVERLAY_ATTR.
    const onOwnOverlay = !!hit?.closest(`[${OVERLAY_ATTR}]`);
    const hitTarget = hit?.closest<HTMLElement>("[data-langy-target]");
    const hovered = onOwnOverlay
      ? useLangyContextTargetStore.getState().hoveredId
      : hitTarget && isReachable(hitTarget)
        ? (hitTarget.dataset.langyTarget ?? null)
        : null;

    // Reaching for a revealed target holds its light. The reveal is a couple of
    // seconds long by design ("a look, not a state"), which is plenty to SEE and
    // nowhere near enough to read a row, decide, and click it — and an offer
    // that expires under the pointer taking it up is worse than no offer.
    if (hovered) {
      const targets = useLangyContextTargetStore.getState();
      if (targets.revealedIds.has(hovered)) targets.holdReveal();
    }

    const nearIds: string[] = [];
    for (const { id, rect } of rectsRef.current) {
      if (distanceToRect(pointer, rect) > PROXIMITY_PX) continue;
      nearIds.push(id);
    }

    setProximity({ nearIds, hoveredId: hovered });
  }, [setProximity]);

  const schedule = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(resolve);
  }, [resolve]);

  useEffect(() => {
    measure();

    const onPointerMove = (event: PointerEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const onPointerLeave = () => {
      pointerRef.current = null;
      schedule();
    };
    const onGeometryChange = () => {
      measure();
      schedule();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    document.addEventListener("pointerleave", onPointerLeave);
    // Capture: the trace table scrolls in its own viewport, not the window, and
    // a non-capturing window listener never hears about that.
    window.addEventListener("scroll", onGeometryChange, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", onGeometryChange, { passive: true });
    // A drawer or dialog opening does not scroll, resize, or change the target
    // registry — but it does take focus, and it does mark everything behind it
    // `aria-hidden`. `focusin` is the cheap, reliable moment to re-measure and
    // let the newly-covered targets drop out.
    document.addEventListener("focusin", onGeometryChange);

    // Rows mount and unmount constantly as the virtualizer scrolls, which
    // invalidates the cache. Subscribe imperatively rather than with a selector:
    // this must NOT re-render the layer, it only has to dirty a ref.
    const unsubscribe = useLangyContextTargetStore.subscribe(
      (state, previous) => {
        if (state.targets !== previous.targets) onGeometryChange();
      },
    );

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("scroll", onGeometryChange, { capture: true });
      window.removeEventListener("resize", onGeometryChange);
      document.removeEventListener("focusin", onGeometryChange);
      unsubscribe();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      useLangyContextTargetStore
        .getState()
        .setProximity({ nearIds: [], hoveredId: null });
    };
  }, [measure, schedule]);

  if (!hoveredId) return null;
  return <TargetAffordance targetId={hoveredId} />;
}

/** Inset from the target's edge, on whichever side the button lands. */
const AFFORDANCE_INSET_PX = 6;

/**
 * Where the button sits on its target.
 *
 * LEFT by default, and that is not arbitrary: the Langy panel is docked on the
 * RIGHT, so a button pinned to a target's right edge is the one most likely to
 * end up underneath it (or crushed against it) — exactly where you can't see or
 * click it. The left edge of a row is the one place that is never contested.
 *
 * It flips right only when the target's own left edge is off-screen (a wide
 * table scrolled horizontally), where a left-anchored button would be the thing
 * that's clipped.
 */
function affordancePlacement(box: DOMRect): "left" | "right" {
  return box.left < AFFORDANCE_INSET_PX ? "right" : "left";
}

/**
 * The button. Floated over the top of the hovered target, INSIDE its bounds — so
 * moving the pointer onto the button keeps you inside the target, and the button
 * doesn't flicker itself out of existence.
 */
function TargetAffordance({ targetId }: { targetId: string }) {
  const target = useLangyContextTargetStore((s) => s.targets[targetId]);
  const isAdded = useLangyContextTargetStore((s) =>
    s.activeChipIds.has(targetId),
  );

  const [box, setBox] = useState<DOMRect | null>(null);

  useEffect(() => {
    const element = document.querySelector<HTMLElement>(
      `[data-langy-target="${CSS.escape(targetId)}"]`,
    );
    if (!element) {
      setBox(null);
      return;
    }
    const track = () => setBox(element.getBoundingClientRect());
    track();

    window.addEventListener("scroll", track, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", track, { passive: true });
    return () => {
      window.removeEventListener("scroll", track, { capture: true });
      window.removeEventListener("resize", track);
    };
  }, [targetId]);

  const onClick = useCallback(() => {
    if (!target) return;
    if (isAdded) {
      releaseContextTarget(target.id);
    } else {
      absorbContextTarget(target);
    }
  }, [target, isAdded]);

  if (!target || !box || typeof document === "undefined") return null;

  const placement = affordancePlacement(box);

  return createPortal(
    <chakra.button
      type="button"
      className={`langy-target-affordance langy-target-affordance--${placement}`}
      data-testid="langy-absorb-context"
      // THE ATTRIBUTE THE HIT TEST LOOKS FOR. Without it the pointer landing
      // on this button read as "the pointer left the target": elementFromPoint
      // returns the button, `closest("[data-langy-target]")` finds nothing
      // (this is portaled to document.body, so it is not a DESCENDANT of the
      // row it floats over), the hovered target clears, and the button
      // unmounts from under the cursor reaching for it. The constant existed
      // for exactly this and was never actually applied, so clicking to absorb
      // was impossible on every surface in the app.
      {...{ [OVERLAY_ATTR]: "" }}
      onClick={onClick}
      // "Absorb" is the verb for taking a thing on the page into Langy's
      // context. "Context" is already this composer's established vocabulary
      // (the chips, the "+ context" control), so the pair reads on first
      // sight. The title carries the reverse, which the label alone can't.
      title={
        isAdded
          ? `Langy has ${target.label} — click to release it`
          : `Give Langy ${target.label}`
      }
      position="fixed"
      top={`${box.top + AFFORDANCE_INSET_PX}px`}
      left={
        placement === "left"
          ? `${box.left + AFFORDANCE_INSET_PX}px`
          : `${box.right - AFFORDANCE_INSET_PX}px`
      }
      // Above drawers and dialogs (1300), not below them. Targets sitting
      // BEHIND a drawer are already disqualified by the occlusion rule, so the
      // only targets that can be hovered while one is open are the ones INSIDE
      // it — like the trace drawer's own header, whose button was drawn
      // underneath the very surface it belonged to and could never be seen.
      zIndex={1350}
      display="inline-flex"
      alignItems="center"
      gap={1}
      paddingLeft={2}
      paddingRight={2.5}
      paddingY={1}
      borderRadius="full"
      borderWidth="1px"
      borderStyle="solid"
      borderColor={isAdded ? "purple.emphasized" : "border.emphasized"}
      background="bg.panel"
      color={isAdded ? "purple.fg" : "fg.muted"}
      boxShadow="sm"
      cursor="pointer"
      textStyle="2xs"
      fontWeight="medium"
      whiteSpace="nowrap"
      _hover={{ borderColor: "purple.emphasized", color: "purple.fg" }}
    >
      {isAdded ? <Check size={11} /> : <Sparkles size={11} />}
      {isAdded ? "Absorbed" : "Absorb context"}
    </chakra.button>,
    document.body,
  );
}

/** 0 when the point is inside the rect; otherwise the shortest gap to its edge. */
function distanceToRect(
  point: { x: number; y: number },
  rect: DOMRect,
): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
}
