import { chakra } from "@chakra-ui/react";
import { Check, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "../langyContextTarget.css";
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
 * Nothing here runs while the panel is closed: it returns null before any
 * listener is attached, so a page without Langy open pays literally nothing.
 */

/** How close the pointer has to get before a target admits it exists (px). */
const PROXIMITY_PX = 140;

interface TargetRect {
  id: string;
  rect: DOMRect;
}

export function LangyContextTargetLayer() {
  const isOpen = useLangyStore((state) => state.isOpen);
  if (!isOpen) return null;
  return <ActiveLayer />;
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

    const nearIds: string[] = [];
    let hovered: string | null = null;
    let hoveredArea = Number.POSITIVE_INFINITY;

    for (const { id, rect } of rectsRef.current) {
      const distance = distanceToRect(pointer, rect);
      if (distance > PROXIMITY_PX) continue;
      nearIds.push(id);
      if (distance > 0) continue;
      // Targets can nest (a row inside a table that is itself a target one day).
      // The SMALLEST box under the pointer is the one the user means.
      const area = rect.width * rect.height;
      if (area < hoveredArea) {
        hoveredArea = area;
        hovered = id;
      }
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
      // Keep dialogs and drawers above the persistent context affordance.
      zIndex={1250}
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
