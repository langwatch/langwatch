/**
 * SpotlightOverlay — the Phase 2 contextual tour popover system.
 */
import { Box, Button, Flex, HStack, Portal, Text } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { useOnboardingStore } from "../../../../../behavior/explorer/onboarding/store/onboarding-store.ts";
import type {
  Spotlight,
  SpotlightContext,
} from "../../../../../model/explorer/onboarding/spotlights/spotlights.ts";
import { TRACE_EXPLORER_SPOTLIGHTS } from "../../../../../model/explorer/onboarding/spotlights/spotlights.ts";
import { useTraceExplorerTourPreference } from "../hooks/use-trace-explorer-tour-preference.ts";

// ---------------------------------------------------------------------------
// URL fragment helpers (scoped to sp= prefix so we don't clobber the
// existing lens/query fragment that useURLSync manages).
// ---------------------------------------------------------------------------

const SP_PREFIX = "sp=";

export function readSpotlightFragment(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.slice(1); // strip leading #
  if (!hash.startsWith(SP_PREFIX)) return null;
  return decodeURIComponent(hash.slice(SP_PREFIX.length)) || null;
}

export function writeSpotlightFragment(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id === null) {
    // If there's no other fragment content, remove the hash entirely.
    const bare = window.location.pathname + window.location.search;
    window.history.replaceState(null, "", bare);
  } else {
    const newHash = `#${SP_PREFIX}${encodeURIComponent(id)}`;
    const newURL = window.location.pathname + window.location.search + newHash;
    if (newURL !== window.location.href) {
      window.history.replaceState(null, "", newURL);
    }
  }
}

// ---------------------------------------------------------------------------
// URL sync hook — call once in TracesPage or in SpotlightOverlay itself
// ---------------------------------------------------------------------------

/**
 * On mount reads `#sp=<id>` from the URL and, if present, activates the
 * spotlight tour at that id. Exported so tests can invoke it directly.
 */
export function useSpotlightURLSync(): void {
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore((s) => s.setCurrentSpotlightId);

  useEffect(() => {
    const id = readSpotlightFragment();
    if (id) {
      setSpotlightsActive(true);
      setCurrentSpotlightId(id);
    }
    // Only run on mount — later navigation writes the fragment directly
    // via writeSpotlightFragment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

// ---------------------------------------------------------------------------
// Anchor position measurement
// ---------------------------------------------------------------------------

export interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function measureAnchor(anchor: string): AnchorRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(`[data-spotlight="${anchor}"]`);
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * True when an anchor's left edge sits at or beyond the right viewport edge, i.e. it is
 * still parked off-screen by an entrance animation (the drawer, or Langy's companion
 * ride, slides in from the right). A zero-rect (jsdom) reads as on-screen.
 */
export function isAnchorParkedOffscreen(
  rect: AnchorRect,
  viewportWidth: number,
  scrollX: number,
): boolean {
  return rect.left - scrollX >= viewportWidth;
}

// Spotlight ring placement requires settled anchor: on-screen and rect
// unchanged from previous frame.
// Spec: specs/langy/langy-panel-layout.feature
export function isAnchorSettled({
  next,
  previous,
  viewportWidth,
  scrollX,
}: {
  next: AnchorRect | null;
  previous: AnchorRect | null;
  viewportWidth: number;
  scrollX: number;
}): boolean {
  if (next === null || previous === null) return false;
  if (isAnchorParkedOffscreen(next, viewportWidth, scrollX)) return false;
  return (
    next.top === previous.top &&
    next.left === previous.left &&
    next.width === previous.width &&
    next.height === previous.height
  );
}

// ---------------------------------------------------------------------------
// Walk helpers
// ---------------------------------------------------------------------------

function resolveSpotlight({
  id,
  ctx,
}: {
  id: string | null;
  ctx: SpotlightContext;
}): Spotlight | null {
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter((s) => !s.isApplicable || s.isApplicable(ctx));
  if (list.length === 0) return null;
  if (id === null) return list[0] ?? null;
  return list.find((s) => s.id === id) ?? list[0] ?? null;
}

function nextSpotlight({
  currentId,
  ctx,
}: {
  currentId: string | null;
  ctx: SpotlightContext;
}): Spotlight | null {
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter((s) => !s.isApplicable || s.isApplicable(ctx));
  if (list.length === 0) return null;
  const idx = list.findIndex((s) => s.id === currentId);
  return list[idx + 1] ?? null;
}

function prevSpotlight({
  currentId,
  ctx,
}: {
  currentId: string | null;
  ctx: SpotlightContext;
}): Spotlight | null {
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter((s) => !s.isApplicable || s.isApplicable(ctx));
  if (list.length === 0) return null;
  const idx = list.findIndex((s) => s.id === currentId);
  if (idx <= 0) return null;
  return list[idx - 1] ?? null;
}

function spotlightIndex({ currentId, ctx }: { currentId: string | null; ctx: SpotlightContext }): {
  index: number;
  total: number;
} {
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter((s) => !s.isApplicable || s.isApplicable(ctx));
  const idx = list.findIndex((s) => s.id === currentId);
  return { index: idx >= 0 ? idx : 0, total: list.length };
}

// ---------------------------------------------------------------------------
// SpotlightPopover — the floating box. Positioned absolutely in a portal
// so it sits above page content regardless of stacking contexts.
// ---------------------------------------------------------------------------

interface SpotlightPopoverProps {
  spotlight: Spotlight;
  anchorRect: AnchorRect;
  /** Zero-based position of this step within its tour/queue. */
  stepIndex: number;
  /** Total number of steps in the tour/queue. */
  stepTotal: number;
  onNext: () => void;
  onBack: () => void;
  onDismiss: () => void;
}

export function SpotlightPopover({
  spotlight,
  anchorRect,
  stepIndex,
  stepTotal,
  onNext,
  onBack,
  onDismiss,
}: SpotlightPopoverProps): React.ReactElement {
  const index = stepIndex;
  const total = stepTotal;
  const hasNext = index < total - 1;
  const hasPrev = index > 0;

  // Measure the rendered popover so the bottom clamp uses the real
  // height — anchors near the bottom of the viewport (a low sidebar
  // drilldown, a drawer accordion) were pushing the box off the page
  // because only the top/left edges were clamped.
  const boxRef = useRef<HTMLDivElement>(null);
  const [measuredHeight, setMeasuredHeight] = useState(0);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setMeasuredHeight(box.offsetHeight));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Position calculation — place below the anchor by default; flip to
  // above when too close to the bottom of the viewport.
  const placement = spotlight.placement ?? "bottom";
  const POPOVER_W = 320;
  const POPOVER_OFFSET = 10;

  let top: number;
  let left: number;

  if (placement === "bottom") {
    top = anchorRect.top + anchorRect.height + POPOVER_OFFSET;
    left = anchorRect.left + anchorRect.width / 2 - POPOVER_W / 2;
  } else if (placement === "top") {
    // Height is unknown at layout time; we estimate 120px
    top = anchorRect.top - 120 - POPOVER_OFFSET;
    left = anchorRect.left + anchorRect.width / 2 - POPOVER_W / 2;
  } else if (placement === "right") {
    top = anchorRect.top + anchorRect.height / 2 - 60;
    left = anchorRect.left + anchorRect.width + POPOVER_OFFSET;
  } else {
    // left
    top = anchorRect.top + anchorRect.height / 2 - 60;
    left = anchorRect.left - POPOVER_W - POPOVER_OFFSET;
  }

  // Clamp to viewport — all four edges. The bottom clamp uses the
  // measured height once available (first paint estimates 160px, then
  // the effect above corrects within a frame).
  if (typeof window !== "undefined") {
    const estimatedHeight = measuredHeight || 160;
    left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_W - 8));
    top = Math.max(8, Math.min(top, window.innerHeight - estimatedHeight - 8));
  }

  return (
    <Box
      ref={boxRef}
      data-testid="spotlight-popover"
      position="fixed"
      top={`${top}px`}
      left={`${left}px`}
      width={`${POPOVER_W}px`}
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="xl"
      boxShadow="xl"
      zIndex={1500}
      overflow="hidden"
    >
      {/* Brand hairline — the same warm gradient family as the Ask AI
          chip, so the tour chrome reads as part of the product's voice
          rather than a generic library popover. */}
      <Box
        height="3px"
        bgGradient="to-r"
        gradientFrom="orange.solid"
        gradientVia="pink.solid"
        gradientTo="purple.solid"
      />
      {/* Header strip */}
      <Flex
        align="center"
        justify="space-between"
        paddingX={3}
        paddingTop={3}
        paddingBottom={spotlight.title ? 1 : 3}
      >
        {spotlight.title ? (
          <Text textStyle="sm" fontWeight="600" color="fg">
            {spotlight.title}
          </Text>
        ) : (
          <Box />
        )}
        <HStack gap={1.5} align="center">
          {/* Progress dots — one per step, filled up to the current.
              Scannable at a glance where "2 / 4" required reading. */}
          <HStack gap={1} aria-label={`Step ${index + 1} of ${total}`}>
            {Array.from({ length: total }, (_, i) => (
              <Box
                // Dots are positional by definition.
                key={i}
                width={i === index ? "14px" : "5px"}
                height="5px"
                borderRadius="full"
                bg={i <= index ? "orange.solid" : "border.emphasized"}
                transition="width 0.2s ease, background 0.2s ease"
              />
            ))}
          </HStack>
          <Button
            size="2xs"
            variant="ghost"
            color="fg.subtle"
            aria-label="Dismiss tour"
            onClick={onDismiss}
            minWidth={0}
            paddingX={1}
          >
            ✕
          </Button>
        </HStack>
      </Flex>

      {/* Body */}
      {spotlight.body && (
        <Box paddingX={3} paddingBottom={3}>
          <Text textStyle="sm" color="fg.muted">
            {spotlight.body}
          </Text>
        </Box>
      )}

      {/* Footer navigation. `Skip tour` sits on the left so it reads as
          an escape hatch rather than competing with Next for the
          primary action role on the right. We can't force users
          through the tour — making the exit always visible (in
          addition to the header ✕) means anyone who's already
          oriented can leave with one click without hunting for the
          close glyph. */}
      <Flex align="center" justify="space-between" gap={2} paddingX={3} paddingBottom={3}>
        <Button
          size="xs"
          variant="ghost"
          color="fg.subtle"
          onClick={onDismiss}
          aria-label="Skip tour"
        >
          Skip tour
        </Button>
        <Flex align="center" gap={2}>
          {hasPrev && (
            <Button size="xs" variant="ghost" onClick={onBack} aria-label="Previous spotlight">
              Back
            </Button>
          )}
          {hasNext ? (
            <Button
              size="xs"
              variant="solid"
              colorPalette="blue"
              onClick={onNext}
              aria-label="Next spotlight"
            >
              Next
            </Button>
          ) : (
            <Button
              size="xs"
              variant="solid"
              colorPalette="blue"
              onClick={onDismiss}
              aria-label="Finish tour"
            >
              Done
            </Button>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Highlight ring — a thin outline drawn over the anchor element so users
// can see which element the spotlight is talking about.
// ---------------------------------------------------------------------------

export function HighlightRing({ anchorRect }: { anchorRect: AnchorRect }): React.ReactElement {
  // Soft orange focus, not a blue aurora.
  return (
    <Box
      data-testid="spotlight-highlight"
      position="fixed"
      top={`${anchorRect.top - 3}px`}
      left={`${anchorRect.left - 3}px`}
      width={`${anchorRect.width + 6}px`}
      height={`${anchorRect.height + 6}px`}
      borderRadius="md"
      borderWidth="1.5px"
      borderColor="orange.solid"
      pointerEvents="none"
      zIndex={1499}
      // Resting shadow comes from the 0%/100% keyframe; reduced-motion
      // users get it from the explicit boxShadow below instead of the
      // animation.
      boxShadow="0 0 0 4px color-mix(in oklab, var(--chakra-colors-orange-solid) 18%, transparent), 0 0 0 100vmax color-mix(in oklab, var(--chakra-colors-fg) 12%, transparent)"
      css={{
        animation: "lw-spotlight-breathe 2.4s ease-in-out infinite",
        "@keyframes lw-spotlight-breathe": {
          "0%, 100%": {
            boxShadow:
              "0 0 0 4px color-mix(in oklab, var(--chakra-colors-orange-solid) 18%, transparent), 0 0 0 100vmax color-mix(in oklab, var(--chakra-colors-fg) 12%, transparent)",
          },
          "50%": {
            boxShadow:
              "0 0 0 7px color-mix(in oklab, var(--chakra-colors-orange-solid) 30%, transparent), 0 0 0 100vmax color-mix(in oklab, var(--chakra-colors-fg) 12%, transparent)",
          },
        },
        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * What gates each spotlight's isApplicable. `hasEvaluators` defaults to true so
 * the evaluator spotlight shows unless something says otherwise.
 */
const TOUR_CONTEXT: SpotlightContext = { hasEvaluators: true, hasFlameViz: true };

/** The anchor's rect, or its fallback's; none when neither is in the DOM. */
function measureSpotlight(spotlight: Spotlight): AnchorRect | null {
  const rect = measureAnchor(spotlight.anchor);
  if (rect || !spotlight.fallbackAnchor) return rect;
  return measureAnchor(spotlight.fallbackAnchor);
}

/**
 * The spotlight's anchor rect, measured after paint (a rAF keeps it client-only)
 * and again on scroll or resize so the ring tracks a reflowing page. An anchor
 * missing from the DOM is reported, so the tour can move past it.
 */
function useAnchorRect({
  spotlight,
  active,
  onMissing,
}: {
  spotlight: Spotlight | null;
  active: boolean;
  onMissing: (spotlight: Spotlight) => void;
}) {
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const rafRef = useRef<number | null>(null);
  const onMissingRef = useRef(onMissing);
  onMissingRef.current = onMissing;
  const spotlightRef = useRef(spotlight);
  spotlightRef.current = spotlight;

  const remeasure = useCallback(() => {
    const current = spotlightRef.current;
    if (!current) {
      setAnchorRect(null);
      return;
    }
    const rect = measureSpotlight(current);
    if (rect) setAnchorRect(rect);
    else onMissingRef.current(current);
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(remeasure);
  }, [remeasure]);

  useEffect(() => {
    if (!spotlight) {
      setAnchorRect(null);
      return;
    }
    schedule();
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [spotlight, schedule]);

  useEffect(() => {
    if (!active) return;
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [active, schedule]);

  return anchorRect;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
  );
}

/**
 * Escape ends the tour. The tour is non-modal, so an Escape meant to clear or
 * blur a field the reader is typing in leaves it alone.
 */
function useEscapeToDismiss({ active, onDismiss }: { active: boolean; onDismiss: () => void }) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isTypingTarget(e.target)) onDismissRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}

export function TourMotion({
  motionKey,
  style,
  children,
}: {
  motionKey: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={motionKey}
        initial={{ opacity: 0, scale: 0.95, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: -4 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        style={style}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export const RING_LAYER_STYLE: React.CSSProperties = {
  pointerEvents: "none",
  position: "fixed",
  inset: 0,
  zIndex: 1498,
};

/**
 * Drop-in at the TracesPage root. Subscribes to `spotlightsActive` +
 * `currentSpotlightId`. When active, renders a floating popover next to the current
 * spotlight's anchor element.
 */
export function SpotlightOverlay(): React.ReactElement | null {
  const { dismiss: persistDismissal } = useTraceExplorerTourPreference();
  const spotlightsActive = useOnboardingStore((s) => s.spotlightsActive);
  const currentSpotlightId = useOnboardingStore((s) => s.currentSpotlightId);
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore((s) => s.setCurrentSpotlightId);

  useSpotlightURLSync();

  const resolved = spotlightsActive
    ? resolveSpotlight({ id: currentSpotlightId, ctx: TOUR_CONTEXT })
    : null;

  const endTour = useCallback(() => {
    setSpotlightsActive(false);
    setCurrentSpotlightId(null);
    writeSpotlightFragment(null);
  }, [setCurrentSpotlightId, setSpotlightsActive]);

  const goTo = useCallback(
    (id: string) => {
      setCurrentSpotlightId(id);
      writeSpotlightFragment(id);
    },
    [setCurrentSpotlightId],
  );

  const handleDismiss = useCallback(() => {
    persistDismissal();
    endTour();
  }, [persistDismissal, endTour]);

  // A step whose anchor is not on the page is skipped; past the last, the tour ends.
  const anchorRect = useAnchorRect({
    spotlight: resolved,
    active: spotlightsActive,
    onMissing: (missing) => {
      const next = nextSpotlight({ currentId: missing.id, ctx: TOUR_CONTEXT });
      if (next) goTo(next.id);
      else endTour();
    },
  });
  useEscapeToDismiss({ active: spotlightsActive, onDismiss: handleDismiss });

  const resolvedId = resolved?.id ?? null;
  const handleNext = useCallback(() => {
    const next = nextSpotlight({ currentId: resolvedId, ctx: TOUR_CONTEXT });
    if (next) goTo(next.id);
    else handleDismiss();
  }, [resolvedId, goTo, handleDismiss]);

  const handleBack = useCallback(() => {
    const prev = prevSpotlight({ currentId: resolvedId, ctx: TOUR_CONTEXT });
    if (prev) goTo(prev.id);
  }, [resolvedId, goTo]);

  if (!spotlightsActive || !resolved || !anchorRect) return null;

  const pageStep = spotlightIndex({ currentId: resolved.id, ctx: TOUR_CONTEXT });

  return (
    <Portal>
      <TourMotion motionKey={resolved.id} style={RING_LAYER_STYLE}>
        <HighlightRing anchorRect={anchorRect} />
      </TourMotion>
      <TourMotion motionKey={resolved.id}>
        <SpotlightPopover
          spotlight={resolved}
          anchorRect={anchorRect}
          stepIndex={pageStep.index}
          stepTotal={pageStep.total}
          onNext={handleNext}
          onBack={handleBack}
          onDismiss={handleDismiss}
        />
      </TourMotion>
    </Portal>
  );
}
