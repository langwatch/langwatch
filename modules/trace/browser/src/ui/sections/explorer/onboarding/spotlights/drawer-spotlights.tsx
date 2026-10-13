/**
 * DrawerSpotlights — condition-gated, show-once spotlights inside the trace drawer.
 */
import { Portal } from "@langwatch/design-system/primitives";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useOnboardingStore } from "../../../../../behavior/explorer/onboarding/store/onboarding-store.ts";
import {
  DRAWER_SPOTLIGHTS,
  type Spotlight,
} from "../../../../../model/explorer/onboarding/spotlights/spotlights.ts";
import { useTraceExplorerTourPreference } from "../hooks/use-trace-explorer-tour-preference.ts";
import {
  type AnchorRect,
  HighlightRing,
  isAnchorParkedOffscreen,
  isAnchorSettled,
  measureAnchor,
  RING_LAYER_STYLE,
  SpotlightPopover,
  TourMotion,
} from "./spotlight-overlay.tsx";

const MAX_SETTLE_FRAMES = 90; // ~1.5s, so a perpetual animation still resolves

/**
 * Whether measuring can stop: the anchor settled, or the frame budget ran out.
 * A rect parked off-screen (the drawer waiting on Langy's entrance) never
 * counts as the previous frame.
 */
function settleStep({
  next,
  previous,
  frames,
}: {
  next: AnchorRect | null;
  previous: AnchorRect | null;
  frames: number;
}): { done: boolean; previous: AnchorRect | null } {
  const viewport = { viewportWidth: window.innerWidth, scrollX: window.scrollX };
  if (frames >= MAX_SETTLE_FRAMES || isAnchorSettled({ next, previous, ...viewport })) {
    return { done: true, previous };
  }
  const parked =
    next !== null && isAnchorParkedOffscreen(next, viewport.viewportWidth, viewport.scrollX);
  return { done: false, previous: parked ? null : next };
}

/**
 * The spotlight's anchor rect, placed only once the anchor has settled (the
 * drawer slides in, and may be parked off-screen first), then re-measured on
 * scroll and resize so the ring follows drawer scrolls.
 */
function useSettledAnchorRect(spotlight: Spotlight | null) {
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!spotlight) {
      setAnchorRect(null);
      return;
    }
    let previous: AnchorRect | null = null;
    let frames = 0;
    const settle = () => {
      const next = measureAnchor(spotlight.anchor);
      const step = settleStep({ next, previous, frames });
      if (step.done) {
        setAnchorRect(next);
        return;
      }
      previous = step.previous;
      frames += 1;
      rafRef.current = requestAnimationFrame(settle);
    };
    rafRef.current = requestAnimationFrame(settle);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [spotlight]);

  useEffect(() => {
    if (!spotlight) return;
    const onScrollOrResize = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setAnchorRect(measureAnchor(spotlight.anchor)));
    };
    window.addEventListener("scroll", onScrollOrResize, { passive: true, capture: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, { capture: true });
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [spotlight]);

  return anchorRect;
}

/**
 * Escape closes the spotlight queue without closing the drawer: captured and
 * stopped only while a spotlight shows, so the drawer's own Escape works otherwise.
 */
function useEscapeCapture({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onDismiss();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [active, onDismiss]);
}

/**
 * The unseen show-once spotlights for this trace, found a frame after open so
 * the drawer's sections exist. Seen is read by ref, so marking the one on
 * screen does not recompute the queue under it.
 */
function useDrawerSpotlightQueue({ traceId, enabled }: { traceId: string; enabled: boolean }) {
  const seenDrawerSpotlights = useOnboardingStore((s) => s.seenDrawerSpotlights);
  const seenRef = useRef(seenDrawerSpotlights);
  seenRef.current = seenDrawerSpotlights;
  const [queue, setQueue] = useState<Spotlight[]>([]);

  useEffect(() => {
    setQueue([]);
    if (!enabled) return;
    const raf = requestAnimationFrame(() => {
      setQueue(
        DRAWER_SPOTLIGHTS.filter((s) => !seenRef.current[s.id] && measureAnchor(s.anchor) !== null),
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [traceId, enabled]);

  return queue;
}

export function DrawerSpotlights({ traceId }: { traceId: string }): React.ReactElement | null {
  const pageTourActive = useOnboardingStore((s) => s.spotlightsActive);
  const markDrawerSpotlightSeen = useOnboardingStore((s) => s.markDrawerSpotlightSeen);
  const { dismiss: persistDismissal, isDismissed } = useTraceExplorerTourPreference();
  const enabled = !pageTourActive && !isDismissed;

  const queue = useDrawerSpotlightQueue({ traceId, enabled });
  const [pos, setPos] = useState(0);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    setPos(0);
    setClosed(false);
  }, [traceId, pageTourActive, isDismissed]);

  const current: Spotlight | null = !closed && enabled ? (queue[pos] ?? null) : null;

  // Seen the moment it shows: show-once even when the queue is dismissed straight after.
  useEffect(() => {
    if (current) markDrawerSpotlightSeen(current.id);
  }, [current, markDrawerSpotlightSeen]);

  const anchorRect = useSettledAnchorRect(current);

  const handleDismiss = useCallback(() => {
    persistDismissal();
    setClosed(true);
  }, [persistDismissal]);
  useEscapeCapture({ active: !!current, onDismiss: handleDismiss });

  const handleNext = useCallback(() => {
    if (pos + 1 >= queue.length) setClosed(true);
    else setPos(pos + 1);
  }, [pos, queue.length]);
  const handleBack = useCallback(() => setPos((p) => Math.max(0, p - 1)), []);

  if (!current || !anchorRect) return null;

  // Ring 1499 and popover 1500 sit above the Chakra Drawer's modal z-index (1400).
  return (
    <Portal>
      <TourMotion motionKey={`ring-${current.id}`} style={RING_LAYER_STYLE}>
        <HighlightRing anchorRect={anchorRect} />
      </TourMotion>
      <TourMotion motionKey={`popover-${current.id}`}>
        <SpotlightPopover
          spotlight={current}
          anchorRect={anchorRect}
          stepIndex={pos}
          stepTotal={queue.length}
          onNext={handleNext}
          onBack={handleBack}
          onDismiss={handleDismiss}
        />
      </TourMotion>
    </Portal>
  );
}
