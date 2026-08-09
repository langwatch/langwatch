import { Box } from "@chakra-ui/react";
import { type RefObject, useEffect, useState } from "react";

/** How long the turn under review blinks for when the reader arrives on it. */
const BLINK_MS = 900;

const BLINK_KEYFRAMES = `
@keyframes tracesV2FocusedTurnBlink {
  0% { background-color: var(--chakra-colors-blue-subtle); }
  35% { background-color: var(--chakra-colors-blue-muted); }
  100% { background-color: var(--chakra-colors-blue-subtle); }
}`;

/**
 * Whether the turn under review should blink right now.
 *
 * Once on arrival, and once more each time the reader is moved to a different
 * turn. The tint stays either way; the blink is only what makes the eye land in
 * the right place, so it is over as soon as it has done that.
 */
export function useFocusedTurnBlink(focusTraceId: string | undefined): boolean {
  const [blinkingFor, setBlinkingFor] = useState<string | null>(null);

  useEffect(() => {
    if (!focusTraceId) return;
    setBlinkingFor(focusTraceId);
    const timer = window.setTimeout(() => setBlinkingFor(null), BLINK_MS);
    return () => window.clearTimeout(timer);
  }, [focusTraceId]);

  return !!focusTraceId && blinkingFor === focusTraceId;
}

/**
 * The turn under review, told apart from the rest of the thread.
 *
 * A background tint rather than a border or a marker: it survives the reader
 * scrolling away and back, reads at a glance from anywhere in the thread, and
 * is a different colour family from the amber a turn's annotations use, so
 * "this is the one I was sent to" and "this one has been commented on" never
 * read as the same thing.
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
      bg="blue.subtle"
      borderRadius="lg"
      animation={
        isBlinking
          ? `tracesV2FocusedTurnBlink ${BLINK_MS}ms ease-in-out`
          : undefined
      }
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
 * Brings the turn under review onto the screen, and brings the next one on when
 * the reader is moved along. Measured against the scroll container the way the
 * open turn's own centering is, because `offsetTop` is relative to the nearest
 * positioned ancestor, which that container is.
 *
 * Centering is re-applied until the turn's offset stops moving: the turns
 * above it (their annotation cards especially) measure in after the first
 * paint and push it further down, so a single scroll lands short of where the
 * turn ends up. The loop only issues a scroll when the target has actually
 * moved, and gives up after a beat so it can never fight the reader's own
 * scrolling for long.
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
    let lastApplied = Number.NEGATIVE_INFINITY;
    let frame = 0;
    const startedAt = performance.now();
    const center = () => {
      const top = Math.max(
        0,
        focused.offsetTop -
          container.clientHeight / 2 +
          focused.offsetHeight / 2,
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
  }, [scrollRef, focusedRef, focusTraceId]);
}
