/**
 * DrawerSpotlights — condition-gated, show-once spotlights inside the
 * trace drawer.
 *
 * Unlike the page tour (SpotlightOverlay), there's no linear walkthrough:
 * each DRAWER_SPOTLIGHTS entry fires exactly once in the current browser,
 * the first time a drawer opens where the feature is actually present.
 * The server-backed preference suppresses the entire automatic queue for
 * a user after any tour dismissal, including on other projects or devices.
 * Anchored components only emit their `data-spotlight` attribute when the
 * feature has content, so anchor presence is the display condition.
 *
 * Show-once semantics: a spotlight is marked seen the moment it is
 * DISPLAYED (not when acknowledged), so it never repeats — even if the
 * user dismisses the queue. Dismissing (✕ / Esc / Done) closes the queue
 * for this drawer open; entries that were queued but never displayed stay
 * unseen and can fire on a future drawer.
 */
import { Portal } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTraceExplorerTourPreference } from "../hooks/useTraceExplorerTourPreference";
import { useOnboardingStore } from "../store/onboardingStore";
import {
  type AnchorRect,
  HighlightRing,
  isAnchorParkedOffscreen,
  isAnchorSettled,
  measureAnchor,
  SpotlightPopover,
} from "./SpotlightOverlay";
import { DRAWER_SPOTLIGHTS, type Spotlight } from "./spotlights";

export function DrawerSpotlights({
  traceId,
}: {
  traceId: string;
}): React.ReactElement | null {
  const pageTourActive = useOnboardingStore((s) => s.spotlightsActive);
  const seenDrawerSpotlights = useOnboardingStore(
    (s) => s.seenDrawerSpotlights,
  );
  const markDrawerSpotlightSeen = useOnboardingStore(
    (s) => s.markDrawerSpotlightSeen,
  );
  const { dismiss: persistDismissal, isDismissed } =
    useTraceExplorerTourPreference();

  // The queue is computed once per trace (after a rAF so the drawer's
  // content has painted). Freeze the seen-map behind a ref so marking
  // the currently-displayed spotlight seen doesn't recompute the queue
  // out from under itself.
  const seenRef = useRef(seenDrawerSpotlights);
  seenRef.current = seenDrawerSpotlights;

  const [queue, setQueue] = useState<Spotlight[]>([]);
  const [pos, setPos] = useState(0);
  const [closed, setClosed] = useState(false);
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);

  const rafRef = useRef<number | null>(null);

  // Compute the queue on mount / trace change. The rAF lets the drawer's
  // accordion sections land in the DOM before we probe for anchors.
  useEffect(() => {
    setQueue([]);
    setPos(0);
    setClosed(false);
    setAnchorRect(null);
    if (pageTourActive || isDismissed) return;
    const raf = requestAnimationFrame(() => {
      const next = DRAWER_SPOTLIGHTS.filter(
        (s) => !seenRef.current[s.id] && measureAnchor(s.anchor) !== null,
      );
      setQueue(next);
    });
    return () => cancelAnimationFrame(raf);
  }, [traceId, pageTourActive, isDismissed]);

  const current: Spotlight | null =
    !closed && !pageTourActive && !isDismissed ? (queue[pos] ?? null) : null;

  // Mark the spotlight seen the moment it is displayed — show-once even
  // when the queue is dismissed straight after.
  useEffect(() => {
    if (current) markDrawerSpotlightSeen(current.id);
  }, [current, markDrawerSpotlightSeen]);

  // Measure the current anchor; remeasure on scroll/resize so the ring
  // tracks the anchor through drawer scrolls and window resizes.
  const remeasure = useCallback(() => {
    setAnchorRect(current ? measureAnchor(current.anchor) : null);
  }, [current]);

  // Place the ring only once the anchor has SETTLED. On open the drawer
  // slides in, and when Langy rides alongside as the companion the drawer
  // is parked fully off-screen during the ride's entrance delay. A single
  // rAF-after-mount can catch the anchor mid-slide (or parked off-screen)
  // and the fixed ring plus its full-viewport scrim would stick there. So
  // poll each frame until the anchor is on-screen and holds still for two
  // consecutive frames, capped — robust against any entrance animation.
  useEffect(() => {
    if (!current) {
      setAnchorRect(null);
      return;
    }
    let previous: AnchorRect | null = null;
    let frames = 0;
    const MAX_FRAMES = 90; // ~1.5s ceiling so a perpetual animation still resolves
    const settle = () => {
      const next = measureAnchor(current.anchor);
      const parked =
        next !== null &&
        isAnchorParkedOffscreen(next, window.innerWidth, window.scrollX);
      if (
        isAnchorSettled(next, previous, window.innerWidth, window.scrollX) ||
        frames >= MAX_FRAMES
      ) {
        setAnchorRect(next);
        return;
      }
      previous = parked ? null : next;
      frames += 1;
      rafRef.current = requestAnimationFrame(settle);
    };
    rafRef.current = requestAnimationFrame(settle);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [current]);

  useEffect(() => {
    if (!current) return;
    const onScrollOrResize = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(remeasure);
    };
    window.addEventListener("scroll", onScrollOrResize, {
      passive: true,
      capture: true,
    });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, {
        capture: true,
      });
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [current, remeasure]);

  const handleDismiss = useCallback(() => {
    persistDismissal();
    setClosed(true);
  }, [persistDismissal]);

  const handleNext = useCallback(() => {
    setPos((p) => {
      if (p + 1 >= queue.length) {
        setClosed(true);
        return p;
      }
      return p + 1;
    });
  }, [queue.length]);

  const handleBack = useCallback(() => {
    setPos((p) => Math.max(0, p - 1));
  }, []);

  // Esc closes the spotlight queue without closing the drawer. Capture
  // phase + stopPropagation only while a spotlight is visible, so the
  // drawer's own Esc-to-close never sees the event mid-spotlight but
  // works normally otherwise.
  useEffect(() => {
    if (!current) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [current, handleDismiss]);

  if (!current || !anchorRect) return null;

  // zIndex band 1498–1500 (ring 1499, popover 1500 inside the shared
  // SpotlightPopover/HighlightRing internals) sits above the Chakra
  // Drawer, whose `modal` z-index token is 1400.
  return (
    <Portal>
      <AnimatePresence mode="wait">
        <motion.div
          key={`ring-${current.id}`}
          initial={{ opacity: 0, scale: 0.95, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          style={{
            pointerEvents: "none",
            position: "fixed",
            inset: 0,
            zIndex: 1498,
          }}
        >
          <HighlightRing anchorRect={anchorRect} />
        </motion.div>
      </AnimatePresence>
      <AnimatePresence mode="wait">
        <motion.div
          key={`popover-${current.id}`}
          initial={{ opacity: 0, scale: 0.95, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <SpotlightPopover
            spotlight={current}
            anchorRect={anchorRect}
            stepIndex={pos}
            stepTotal={queue.length}
            onNext={handleNext}
            onBack={handleBack}
            onDismiss={handleDismiss}
          />
        </motion.div>
      </AnimatePresence>
    </Portal>
  );
}
