import { Box } from "@chakra-ui/react";
import { type RefObject, useEffect, useState } from "react";

/** How long the turn under review blinks for when the reader arrives on it. */
const BLINK_MS = 900;

/**
 * The tint the turn under review rests under: the blue the theme uses for a subtle
 * surface, thinned to half so it reads as a wash over the conversation rather than a
 * panel of its own.
 */
const TINT_RESTING = "color-mix(in srgb, var(--chakra-colors-blue-subtle) 50%, transparent)";

/** What the blink rises to: the same blue at full strength, so it registers. */
const TINT_BLINK_PEAK = "var(--chakra-colors-blue-subtle)";

const BLINK_KEYFRAMES = `
@keyframes tracesV2FocusedTurnBlink {
  0% { background-color: ${TINT_RESTING}; }
  35% { background-color: ${TINT_BLINK_PEAK}; }
  100% { background-color: ${TINT_RESTING}; }
}`;

/**
 * How long the conversation rests where it loaded before carrying the reader to the
 * turn under review.
 */
export const FOCUS_SCROLL_REST_MS = 500;

/**
 * Whether the turn under review should blink right now.
 */
export function useFocusedTurnBlink(focusTraceId: string | undefined): boolean {
  const [blinkingFor, setBlinkingFor] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTraceId) return;
    let end = 0;
    const start = window.setTimeout(() => {
      setBlinkingFor(focusTraceId);
      end = window.setTimeout(() => setBlinkingFor(null), BLINK_MS);
    }, FOCUS_SCROLL_REST_MS);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
    };
  }, [focusTraceId]);

  return !!focusTraceId && blinkingFor === focusTraceId;
}

/**
 * How far the tint reaches past the turn it wraps, so the messages sit in it
 * rather than against its edges. Taken straight back out as margin: a turn put
 * under review must not push the turns around it out of place.
 */
const TINT_BLEED_PX = 6;

/**
 * The turn under review, told apart from the rest of the thread.
 */
export function FocusedTurnFrame({
  isFocused,
  isBlinking,
  children,
}: {
  isFocused: boolean;
  isBlinking: boolean;
  children: React.ReactNode;
}) {
  if (!isFocused) return <>{children}</>;
  return (
    <Box
      data-focused-turn="true"
      bg={TINT_RESTING}
      borderRadius="lg"
      padding={`${TINT_BLEED_PX}px`}
      margin={`-${TINT_BLEED_PX}px`}
      animation={isBlinking ? `tracesV2FocusedTurnBlink ${BLINK_MS}ms ease-in-out` : undefined}
    >
      <style>{BLINK_KEYFRAMES}</style>
      {children}
    </Box>
  );
}

/** How long arrival keeps chasing the turn while the thread is still laying out. */
const SETTLE_MS = 1500;
/** Layout jitter smaller than this is not worth another scroll. */
const SETTLE_TOLERANCE_PX = 8;

/**
 * Centers the turn in its container and keeps re-centering until its offset stops
 * moving, then lets go.
 */
function centerUntilSettled({
  container,
  focused,
}: {
  container: HTMLDivElement;
  focused: HTMLDivElement;
}): () => void {
  let lastApplied = Number.NEGATIVE_INFINITY;
  let frame = 0;
  const startedAt = performance.now();
  const center = () => {
    const top = Math.max(
      0,
      focused.offsetTop - container.clientHeight / 2 + focused.offsetHeight / 2,
    );
    if (Math.abs(top - lastApplied) > SETTLE_TOLERANCE_PX) {
      lastApplied = top;
      container.scrollTo({ top, behavior: "smooth" });
    }
    if (performance.now() - startedAt < SETTLE_MS) {
      frame = window.requestAnimationFrame(center);
    }
  };
  center();
  return () => window.cancelAnimationFrame(frame);
}

/**
 * Brings the turn under review onto the screen, and brings the next one on when the
 * reader is moved along.
 */
export function useScrollFocusedTurnIntoView({
  scrollRef,
  focusedRef,
  focusTraceId,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  focusedRef: RefObject<HTMLDivElement | null>;
  focusTraceId: string | undefined;
}) {
  useEffect(() => {
    if (!focusTraceId) return;
    const container = scrollRef.current;
    const focused = focusedRef.current;
    if (!container || !focused) return;
    let stopCentering: (() => void) | null = null;
    const rest = window.setTimeout(() => {
      stopCentering = centerUntilSettled({ container, focused });
    }, FOCUS_SCROLL_REST_MS);
    return () => {
      window.clearTimeout(rest);
      stopCentering?.();
    };
  }, [scrollRef, focusedRef, focusTraceId]);
}
