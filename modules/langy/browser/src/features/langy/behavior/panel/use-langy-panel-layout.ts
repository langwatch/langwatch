import { useDrawer } from "@langwatch/browser-host/drawer";
import {
  LANGY_DODGE_STAGGER_MS,
  langyRestingFloorPx,
  resolveFloatingPanelWidth,
  useLangyStore,
  useReducedMotion,
} from "@langwatch/langy-browser-kit";
import { type RefObject, useEffect, useRef, useState } from "react";

import { useLangyDevMode } from "../../../../behavior/use-langy-dev-mode.ts";
import { useLangyPeekProximity } from "../../../../behavior/use-langy-peek-proximity.ts";
import { useLingeringDodge } from "../../../../behavior/use-lingering-dodge.ts";
import { type LangyPeekPhase, resolvePeekTranslate } from "../../../../model/langy-peek-dock.ts";

/** The viewport's width, kept current across resizes. */
function useViewportWidth(): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return width;
}

/**
 * Where the panel sits: docked or floating, riding beside an open drawer (docked becomes the
 * drawer's companion, floating dodges to the left on a lingering release), and the floating
 * card's width. Spec: specs/langy/langy-panel-layout.feature
 */
export function useLangyPanelPlacement() {
  const isOpen = useLangyStore((s) => s.isOpen);
  const panelMode = useLangyStore((s) => s.panelMode);
  const floating = panelMode === "floating";
  const reduceMotion = useReducedMotion();
  const { currentDrawer } = useDrawer();
  const drawerEdgeHeld = useLingeringDodge({
    active: !!currentDrawer,
    releaseDelayMs: LANGY_DODGE_STAGGER_MS,
    immediate: reduceMotion,
  });
  const viewportWidth = useViewportWidth();
  return {
    panelMode,
    floating,
    reduceMotion,
    drawerEdgeHeld,
    isDrawerCompanion: isOpen && !!currentDrawer && !floating,
    floatingDodgesDrawer: isOpen && drawerEdgeHeld && floating,
    floatingPanelWidth: resolveFloatingPanelWidth(viewportWidth),
  };
}

/**
 * The minimised peek: this panel, slid down to a sliver of itself. The pointer approaching it
 * raises it further; it stands aside while the home's ask field is in use; its body is INERT so
 * the only thing reachable behind the edge is the open control.
 */
export function useLangyPanelPeek({
  peekEnabled,
  floating,
  reduceMotion,
  drawerEdgeHeld,
}: {
  peekEnabled: boolean;
  floating: boolean;
  reduceMotion: boolean;
  drawerEdgeHeld: boolean;
}) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const panelMode = useLangyStore((s) => s.panelMode);
  const homeAskOpen = useLangyStore((s) => s.homeAskOpen);
  const peeking = peekEnabled && !isOpen;
  const peekNear = useLangyPeekProximity({
    enabled: peeking && !reduceMotion,
    mode: panelMode,
    // The proximity zone follows the floating panel's dodge.
    dodgeLeft: drawerEdgeHeld && floating,
  });
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const phase: LangyPeekPhase = peekNear || hovered || focused ? "near" : "rest";
  // Leaving the peek behind must not strand a stale raise on the next minimise.
  useEffect(() => {
    if (!isOpen) return;
    setHovered(false);
    setFocused(false);
  }, [isOpen]);

  const inertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (inertRef.current) inertRef.current.inert = peeking;
  }, [peeking]);

  return {
    peeking,
    dismissed: peeking && homeAskOpen,
    phase,
    // `translate` composes with the transform framer owns, and takes calc().
    translate: peeking ? resolvePeekTranslate({ mode: panelMode, phase }) : "none",
    inertRef,
    setHovered,
    setFocused,
  };
}

/**
 * Developer mode's inspector, sliding out of the panel's LEFT edge. Leaving developer mode closes
 * it; while open, the floating card's REAL height is observed so the drawer matches it.
 */
export function useLangyDevInspector({ panelRef }: { panelRef: RefObject<HTMLDivElement | null> }) {
  const isOpen = useLangyStore((s) => s.isOpen);
  const [devMode] = useLangyDevMode();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!devMode) setOpen(false);
  }, [devMode]);
  const visible = isOpen && devMode && open;

  const [panelHeightPx, setPanelHeightPx] = useState<number | null>(null);
  useEffect(() => {
    const node = panelRef.current;
    if (!visible || !node || typeof ResizeObserver === "undefined") return;
    const measure = () => setPanelHeightPx(Math.round(node.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible, panelRef]);

  return {
    devMode,
    open,
    visible,
    panelHeightPx,
    close: () => setOpen(false),
    toggle: () => setOpen((current) => !current),
  };
}

/**
 * The floating card's resting floor, as a high-water mark: within one conversation it only ever
 * RISES, so a mid-thread send cannot collapse the card and bounce it back; an empty, settled
 * thread resets it.
 */
export function useLangyFloatingFloor({
  emptyAndSettled,
  expectedMessageCount,
}: {
  emptyAndSettled: boolean;
  expectedMessageCount: number;
}): number {
  const restingFloorPx = langyRestingFloorPx({ emptyAndSettled, expectedMessageCount });
  const highWaterRef = useRef(restingFloorPx);
  if (emptyAndSettled || restingFloorPx > highWaterRef.current) {
    highWaterRef.current = restingFloorPx;
  }
  return highWaterRef.current;
}
