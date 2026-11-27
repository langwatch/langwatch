import { useDrawer } from "@langwatch/browser-host/drawer";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { type RefObject, useEffect, useRef, useState } from "react";

import { useLangyStore } from "../../../../behavior/langy.store.ts";
import { useLangyDevMode } from "../../../../behavior/use-langy-dev-mode.ts";
import { useLangyPeekProximity } from "../../../../behavior/use-langy-peek-proximity.ts";
import { useLingeringDodge } from "../../../../behavior/use-lingering-dodge.ts";
import {
  LANGY_DODGE_STAGGER_MS,
  langyRestingFloorPx,
  SIDEBAR_PANEL_WIDTH,
} from "../../../../model/langy-panel-layout.ts";
import {
  type LangyResizablePlacement,
  resolvePanelWidth,
} from "../../../../model/langy-panel-resize.ts";
import { type LangyPeekPhase, resolvePeekTranslate } from "../../../../model/langy-peek-dock.ts";

/** The viewport's width, kept current across resizes. */
export function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth));
  useEffect(() => {
    const measure = () => setWidth(window.innerWidth);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  return width;
}

/** A layout's width: the user's dragged choice re-clamped to this viewport, else its default. */
function useResolvedPanelWidth({
  placement,
  viewportWidth,
  besideDrawer,
}: {
  placement: LangyResizablePlacement;
  viewportWidth: number;
  besideDrawer?: boolean;
}): number {
  const stored = useLangyStore((s) => s.panelWidths);
  return resolvePanelWidth({
    placement,
    viewportWidth,
    stored: stored[placement],
    besideDrawer,
  });
}

/** The docked panel's width, for whatever reserves room beside it. */
export function useLangyDockWidthPx(): number {
  const viewportWidth = useViewportWidth();
  return useResolvedPanelWidth({ placement: "sidebar", viewportWidth });
}

/**
 * Where the panel sits: docked or floating, riding beside an open drawer (docked becomes the
 * drawer's companion, floating dodges to the left on a lingering release), and the floating
 * card's and the dock's width (the user drags both). Spec: specs/langy/langy-panel-layout.feature
 */
export function useLangyPanelPlacement() {
  const isOpen = useLangyStore((s) => s.isOpen);
  const panelMode = useLangyStore((s) => s.panelMode);
  const floating = panelMode === "floating";
  const reduceMotion = useReducedMotion();
  const { currentDrawer, inPlaceDrawerOpen } = useDrawer();
  const drawerShowing = !!currentDrawer || !!inPlaceDrawerOpen;
  const drawerEdgeHeld = useLingeringDodge({
    active: drawerShowing,
    releaseDelayMs: LANGY_DODGE_STAGGER_MS,
    immediate: reduceMotion,
  });
  const viewportWidth = useViewportWidth();
  const floatingDodgesDrawer = isOpen && drawerEdgeHeld && floating;
  const floatingPanelWidth = useResolvedPanelWidth({
    placement: "floating",
    viewportWidth,
    besideDrawer: floatingDodgesDrawer,
  });
  const dockWidthPx = useResolvedPanelWidth({ placement: "sidebar", viewportWidth });
  const isDrawerCompanion = isOpen && drawerShowing && !floating;
  const resolvedWidthPx = floating ? floatingPanelWidth : dockWidthPx;
  return {
    panelMode,
    floating,
    reduceMotion,
    drawerEdgeHeld,
    isDrawerCompanion,
    floatingDodgesDrawer,
    viewportWidth,
    floatingPanelWidth,
    /** The width the panel renders at; the drawer companion keeps the default dock width. */
    panelWidthPx: isDrawerCompanion ? SIDEBAR_PANEL_WIDTH : resolvedWidthPx,
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
  floatingWidthPx,
}: {
  peekEnabled: boolean;
  floating: boolean;
  reduceMotion: boolean;
  drawerEdgeHeld: boolean;
  floatingWidthPx: number;
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
    floatingWidthPx,
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
