/**
 * SpotlightOverlay — the Phase 2 contextual tour popover system.
 *
 * Mounts once in TracesPage. When `spotlightsActive` is true it finds
 * the current spotlight's anchor element via `[data-spotlight="<anchor>"]`,
 * measures its position, and renders a Chakra-based popover next to it.
 *
 * Non-modal: the user can interact with the page while a spotlight is
 * showing. The popover just floats next to the highlighted element.
 *
 * If the anchor element is not in the DOM (e.g. the trace drawer isn't
 * open yet), the spotlight is skipped to the next applicable one rather
 * than blocking the tour with an invisible popover.
 *
 * URL fragment persistence:
 *   - On mount, if `#sp=<id>` is present, spotlightsActive is flipped on
 *     and currentSpotlightId is set. (Handled by useSpotlightURLSync.)
 *   - On next/back, the fragment is updated.
 *   - On done/dismiss, the fragment is removed.
 */
import { Box, Button, Flex, HStack, Portal, Text } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useOnboardingStore } from "../store/onboardingStore";
import type { Spotlight, SpotlightContext } from "./spotlights";
import { TRACE_EXPLORER_SPOTLIGHTS } from "./spotlights";

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
  const setCurrentSpotlightId = useOnboardingStore(
    (s) => s.setCurrentSpotlightId,
  );

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

interface AnchorRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measureAnchor(anchor: string): AnchorRect | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector<HTMLElement>(
    `[data-spotlight="${anchor}"]`,
  );
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top + window.scrollY,
    left: rect.left + window.scrollX,
    width: rect.width,
    height: rect.height,
  };
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
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter(
    (s) => !s.isApplicable || s.isApplicable(ctx),
  );
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
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter(
    (s) => !s.isApplicable || s.isApplicable(ctx),
  );
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
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter(
    (s) => !s.isApplicable || s.isApplicable(ctx),
  );
  if (list.length === 0) return null;
  const idx = list.findIndex((s) => s.id === currentId);
  if (idx <= 0) return null;
  return list[idx - 1] ?? null;
}

function spotlightIndex({
  currentId,
  ctx,
}: {
  currentId: string | null;
  ctx: SpotlightContext;
}): { index: number; total: number } {
  const list = TRACE_EXPLORER_SPOTLIGHTS.filter(
    (s) => !s.isApplicable || s.isApplicable(ctx),
  );
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
  ctx: SpotlightContext;
  currentId: string | null;
  onNext: () => void;
  onBack: () => void;
  onDismiss: () => void;
}

function SpotlightPopover({
  spotlight,
  anchorRect,
  ctx,
  currentId,
  onNext,
  onBack,
  onDismiss,
}: SpotlightPopoverProps): React.ReactElement {
  const { index, total } = spotlightIndex({ currentId, ctx });
  const hasNext = index < total - 1;
  const hasPrev = index > 0;

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

  // Clamp to viewport
  if (typeof window !== "undefined") {
    left = Math.max(8, Math.min(left, window.innerWidth - POPOVER_W - 8));
    top = Math.max(8, top);
  }

  return (
    <Box
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
                // biome-ignore lint/suspicious/noArrayIndexKey: dots are positional by definition
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
      <Flex
        align="center"
        justify="space-between"
        gap={2}
        paddingX={3}
        paddingBottom={3}
      >
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
            <Button
              size="xs"
              variant="ghost"
              onClick={onBack}
              aria-label="Previous spotlight"
            >
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

function HighlightRing({
  anchorRect,
}: {
  anchorRect: AnchorRect;
}): React.ReactElement {
  // Soft orange focus, not a blue aurora.
  //
  // Design rule: BLUE is reserved on this screen for "you need to act"
  // affordances (the Next/Done buttons in the popover footer, primary
  // action chips, etc.). Using it as a passive "look here" indicator
  // around an arbitrary anchor steals semantic weight from those real
  // CTAs. The ring now does the full stage-light treatment: a huge
  // outer shadow dims the rest of the page (~12%) so the anchor reads
  // as a literal spotlight cutout, and a gentle breathing pulse keeps
  // the eye anchored without strobing. Pointer events stay off — the
  // tour is non-modal and the dim is cosmetic, not a click shield.
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
 * Drop-in at the TracesPage root. Subscribes to `spotlightsActive` +
 * `currentSpotlightId`. When active, renders a floating popover next to
 * the current spotlight's anchor element.
 *
 * Context for `isApplicable` preconditions is built here — the overlay
 * is the right place because it's inside TracesPage and has access to
 * the filter sidebar's descriptor list.
 */
export function SpotlightOverlay(): React.ReactElement | null {
  const spotlightsActive = useOnboardingStore((s) => s.spotlightsActive);
  const currentSpotlightId = useOnboardingStore((s) => s.currentSpotlightId);
  const setSpotlightsActive = useOnboardingStore((s) => s.setSpotlightsActive);
  const setCurrentSpotlightId = useOnboardingStore(
    (s) => s.setCurrentSpotlightId,
  );

  // URL sync on mount
  useSpotlightURLSync();

  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);

  // Context used to gate isApplicable. We leave `hasEvaluators` as a
  // reasonable default (true) so the evaluator spotlight shows unless
  // there's a positive signal it's not there. In the future this could
  // read the discover response.
  const ctx: SpotlightContext = { hasEvaluators: true, hasFlameViz: true };

  const resolved = spotlightsActive
    ? resolveSpotlight({ id: currentSpotlightId, ctx })
    : null;

  // Measure the anchor on every spotlight change (and on scroll/resize
  // so the popover tracks if the page reflows).
  const rafRef = useRef<number | null>(null);

  const remeasure = useCallback(() => {
    if (!resolved) {
      setAnchorRect(null);
      return;
    }
    const rect =
      measureAnchor(resolved.anchor) ??
      (resolved.fallbackAnchor ? measureAnchor(resolved.fallbackAnchor) : null);
    if (!rect) {
      // Anchor not in the DOM — skip to the next applicable spotlight.
      const nxt = nextSpotlight({ currentId: resolved.id, ctx });
      if (nxt) {
        setCurrentSpotlightId(nxt.id);
        writeSpotlightFragment(nxt.id);
      } else {
        // Nothing further — dismiss.
        setSpotlightsActive(false);
        setCurrentSpotlightId(null);
        writeSpotlightFragment(null);
      }
    } else {
      setAnchorRect(rect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved?.anchor, resolved?.fallbackAnchor, resolved?.id]);

  // Measure immediately after DOM paint so absolutely-positioned elements
  // have finished laying out. `useLayoutEffect` would fire synchronously
  // but SSR-unsafe; the rAF keeps the call client-only.
  useEffect(() => {
    if (!resolved) {
      setAnchorRect(null);
      return;
    }
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(remeasure);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [resolved, remeasure]);

  // Re-measure on scroll or resize so the ring tracks the anchor.
  useEffect(() => {
    if (!spotlightsActive) return;
    const onScrollOrResize = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(remeasure);
    };
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [spotlightsActive, remeasure]);

  // Esc dismisses.
  useEffect(() => {
    if (!spotlightsActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleDismiss();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotlightsActive]);

  const handleNext = useCallback(() => {
    const nxt = nextSpotlight({ currentId: resolved?.id ?? null, ctx });
    if (nxt) {
      setCurrentSpotlightId(nxt.id);
      writeSpotlightFragment(nxt.id);
    } else {
      handleDismiss();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved?.id]);

  const handleBack = useCallback(() => {
    const prev = prevSpotlight({ currentId: resolved?.id ?? null, ctx });
    if (prev) {
      setCurrentSpotlightId(prev.id);
      writeSpotlightFragment(prev.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved?.id]);

  const handleDismiss = useCallback(() => {
    setSpotlightsActive(false);
    setCurrentSpotlightId(null);
    writeSpotlightFragment(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!spotlightsActive || !resolved || !anchorRect) return null;

  return (
    <Portal>
      <AnimatePresence mode="wait">
        <motion.div
          key={resolved.id}
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
          key={resolved.id}
          initial={{ opacity: 0, scale: 0.95, y: 6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          <SpotlightPopover
            spotlight={resolved}
            anchorRect={anchorRect}
            ctx={ctx}
            currentId={resolved.id}
            onNext={handleNext}
            onBack={handleBack}
            onDismiss={handleDismiss}
          />
        </motion.div>
      </AnimatePresence>
    </Portal>
  );
}
