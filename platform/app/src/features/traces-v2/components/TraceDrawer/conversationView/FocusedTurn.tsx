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

/**
 * Brings the turn under review onto the screen, and brings the next one on when
 * the reader is moved along. Measured against the scroll container the way the
 * open turn's own centering is, because `offsetTop` is relative to the nearest
 * positioned ancestor, which that container is.
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
    const top =
      focused.offsetTop - container.clientHeight / 2 + focused.offsetHeight / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, [scrollRef, focusedRef, focusTraceId]);
}
