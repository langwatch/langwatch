import { chakra } from "@chakra-ui/react";
import { Check, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../../behavior/langy-context-target.css";
import { useLangyContextArming } from "../../behavior/use-langy-context-arming";
import {
  absorbContextTarget,
  releaseContextTarget,
  useLangyContextTargetStore,
} from "../../behavior/langy-context-target.store";
import { useLangyStore } from "../../behavior/langy.store";

/**
 * The one moving part behind "point at things and add them to Langy". Mounted once,
 * next to the panel.
 */

/** How close the pointer has to get before a target admits it exists (px). */
const PROXIMITY_PX = 140;

interface TargetRect {
  id: string;
  rect: DOMRect;
}

/**
 * Marks the layer's OWN floating chrome.
 */
const OVERLAY_ATTR = "data-langy-overlay";

/**
 * Subtrees the page has taken out of play.
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
      {/* Outside the armed gate: the flourish plays for the absorb that just
          happened, and disarming is frequently the very next thing that
          happens (a click can end the mode). Gating it on ARMED would cut the
          confirmation off mid-play, which is precisely when it is wanted. */}
      {isOpen ? <AbsorbFlashLayer /> : null}
    </>
  );
}

/**
 * Panel → page. The user runs their eye down the context list; whichever chip is under
 * the pointer, its card lights up where it actually sits.
 */
function SpotlightLayer() {
  const spotlightId = useLangyContextTargetStore((s) => s.spotlightId);
  if (!spotlightId) return null;
  return <TargetSpotlight targetId={spotlightId} />;
}

/**
 * The absorb flourish: purple wells up through the thing you just handed over and is
 * gone in half a second.
 */
function AbsorbFlashLayer() {
  const absorbFlash = useLangyContextTargetStore((s) => s.absorbFlash);
  if (!absorbFlash) return null;
  return <AbsorbOoze key={absorbFlash.nonce} targetId={absorbFlash.id} nonce={absorbFlash.nonce} />;
}

/** How long the ooze plays. Mirrors the CSS animation — keep the two equal. */
const ABSORB_OOZE_MS = 500;

function AbsorbOoze({ targetId, nonce }: { targetId: string; nonce: number }) {
  const clearAbsorbFlash = useLangyContextTargetStore((s) => s.clearAbsorbFlash);
  const [box, setBox] = useState<{ rect: DOMRect; radius: string } | null>(null);

  useEffect(() => {
    const element = document.querySelector<HTMLElement>(
      `[data-langy-target="${CSS.escape(targetId)}"]`,
    );
    if (element) {
      setBox({
        rect: element.getBoundingClientRect(),
        // Its own corners, read rather than guessed — a squared-off wash over a
        // rounded card reads as something spilled on the page, not absorbed
        // into it.
        radius: getComputedStyle(element).borderRadius || "0px",
      });
    }
    // Self-clearing: the store holds the flash only for as long as it plays, so
    // nothing has to remember to put it away.
    const done = window.setTimeout(() => clearAbsorbFlash(nonce), ABSORB_OOZE_MS);
    return () => window.clearTimeout(done);
  }, [targetId, nonce, clearAbsorbFlash]);

  if (!box || typeof document === "undefined") return null;

  return createPortal(
    <chakra.div
      className="langy-absorb-ooze"
      data-testid="langy-absorb-ooze"
      aria-hidden
      position="fixed"
      top={`${box.rect.top}px`}
      left={`${box.rect.left}px`}
      width={`${box.rect.width}px`}
      height={`${box.rect.height}px`}
      borderRadius={box.radius}
      pointerEvents="none"
      zIndex={1249}
    />,
    document.body,
  );
}

/** Follows the element: its box, and its own corners. */
function TargetSpotlight({ targetId }: { targetId: string }) {
  const [box, setBox] = useState<{ rect: DOMRect; radius: string } | null>(null);

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
    const track = () => setBox({ rect: element.getBoundingClientRect(), radius });
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
 * Open, but idle. All this does is listen for the arming gesture — one keydown handler,
 * no pointer tracking, no measurement, nothing rendered. The page is untouched until
 * the user asks for it.
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
 * How far up the hint must move to clear whatever else floats at the bottom-center —
 * the selection action bars (`data-bottom-floating-bar`, see `SelectionActionBar`).
 */
function useBottomBarLift(): number {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    const measure = () => {
      let needed = 0;
      const bars = document.querySelectorAll<HTMLElement>("[data-bottom-floating-bar]");
      for (const bar of bars) {
        const rect = bar.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        const clearance = window.innerHeight - rect.top + HINT_BAR_GAP_PX - HINT_BOTTOM_PX;
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
 * The mode indicator.
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
        {source === null ? "these fade in a moment" : "# or Esc to stop"}
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
    const elements = document.querySelectorAll<HTMLElement>("[data-langy-target]");
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

    // Which target is under the pointer is a HIT TEST, not an arithmetic question.
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
    const unsubscribe = useLangyContextTargetStore.subscribe((state, previous) => {
      if (state.targets !== previous.targets) onGeometryChange();
    });

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("scroll", onGeometryChange, { capture: true });
      window.removeEventListener("resize", onGeometryChange);
      document.removeEventListener("focusin", onGeometryChange);
      unsubscribe();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      useLangyContextTargetStore.getState().setProximity({ nearIds: [], hoveredId: null });
    };
  }, [measure, schedule]);

  if (!hoveredId) return null;
  return <TargetAffordance targetId={hoveredId} />;
}

/** Inset from the target's edge, on whichever side the button lands. */
const AFFORDANCE_INSET_PX = 6;

/**
 * Where the button sits on its target.
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
  const isAdded = useLangyContextTargetStore((s) => s.activeChipIds.has(targetId));

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
      // THE ATTRIBUTE THE HIT TEST LOOKS FOR.
      {...{ [OVERLAY_ATTR]: "" }}
      onClick={onClick}
      // "Absorb" is the verb for taking a thing on the page into Langy's
      // context. "Context" is already this composer's established vocabulary
      // (the chips, the "+ context" control), so the pair reads on first
      // sight. The title carries the reverse, which the label alone can't.
      title={
        isAdded ? `Langy has ${target.label} — click to release it` : `Give Langy ${target.label}`
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
function distanceToRect(point: { x: number; y: number }, rect: DOMRect): number {
  const dx = Math.max(rect.left - point.x, 0, point.x - rect.right);
  const dy = Math.max(rect.top - point.y, 0, point.y - rect.bottom);
  return Math.hypot(dx, dy);
}
