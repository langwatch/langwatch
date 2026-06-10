import { Box, Flex, Icon, Text } from "@chakra-ui/react";
import { ArrowUp } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { useTraceNewCount } from "../../hooks/useTraceNewCount";
import { useSseStatusStore } from "../../stores/sseStatusStore";

const SCROLL_THRESHOLD_PX = 80;

// Subtle one-shot bounce when the count first appears (or grows). Avoids
// the previous always-on bob+morph that read as "constantly demanding
// attention" on busy projects — now the pill arrives, settles, and then
// stays put until clicked.
const ARRIVE_KEYFRAMES = {
  "@keyframes tracesV2NewPillArrive": {
    "0%": { transform: "translateX(-50%) translateY(-8px) scale(0.92)", opacity: 0 },
    "60%": { transform: "translateX(-50%) translateY(0) scale(1.02)", opacity: 1 },
    "100%": { transform: "translateX(-50%) translateY(0) scale(1)", opacity: 1 },
  },
} as const;

interface NewTracesScrollUpIndicatorProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Floating "N new" pill that surfaces when fresh traces are buffered.
 * Visible in two cases:
 *
 *   - Live mode + the user has scrolled past `SCROLL_THRESHOLD_PX` —
 *     auto-merge has the rows up-top, but the user is reading further
 *     down and might want to jump back to the latest.
 *   - Ask mode regardless of scroll — the table is frozen on the
 *     snapshot the user was reading, so the pill is the only signal
 *     that new rows are available.
 *
 * Click acknowledges (sets `since = now`, scrolls to top, refetches).
 *
 * Previous incarnation used a morphing-blob orb with two perpetual
 * animations. Replaced with a flat pill that just arrives once and
 * settles — the constant motion read as visual nag on busy projects.
 */
export const NewTracesScrollUpIndicator: React.FC<
  NewTracesScrollUpIndicatorProps
> = ({ scrollRef }) => {
  const { count, acknowledge } = useTraceNewCount();
  const liveUpdatesMode = useSseStatusStore((s) => s.liveUpdatesMode);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setIsScrolled(el.scrollTop > SCROLL_THRESHOLD_PX);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [scrollRef]);

  const visible = count > 0 && (isScrolled || liveUpdatesMode === "ask");

  // Replay the arrive animation each time the count crosses 0→N. Stays
  // still while count is steady so a slowly-growing count doesn't loop
  // the bounce — only the first appearance (and re-appearances after a
  // dismiss) plays.
  const animKeyRef = useRef(0);
  const wasZeroRef = useRef(true);
  if (count > 0 && wasZeroRef.current) {
    animKeyRef.current += 1;
    wasZeroRef.current = false;
  } else if (count === 0) {
    wasZeroRef.current = true;
  }

  if (!visible) return null;

  const handleClick = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    acknowledge();
  };

  const ariaLabel =
    liveUpdatesMode === "ask"
      ? `${count} new trace${count === 1 ? "" : "s"} buffered — click to load`
      : `${count} new trace${count === 1 ? "" : "s"} above — scroll up`;

  return (
    <Box
      position="absolute"
      top="14px"
      left="50%"
      transform="translateX(-50%)"
      zIndex={6}
      pointerEvents="none"
      key={animKeyRef.current}
      css={{
        animation: "tracesV2NewPillArrive 320ms cubic-bezier(0.22, 1, 0.36, 1)",
        ...ARRIVE_KEYFRAMES,
      }}
    >
      <Flex
        as="button"
        onClick={handleClick}
        align="center"
        gap={1.5}
        paddingLeft={2.5}
        paddingRight={3.5}
        paddingY={1.5}
        borderRadius="full"
        cursor="pointer"
        pointerEvents="auto"
        role="status"
        aria-live="polite"
        aria-label={ariaLabel}
        // Solid blue pill with a thin lifted shadow — reads as "actionable
        // notification" without the previous blob/orb visual noise. The
        // border + inset highlight give a subtle glass edge that holds up
        // in both light and dark mode.
        bg="blue.solid"
        color="blue.contrast"
        borderWidth="1px"
        borderColor="blue.emphasized"
        boxShadow="0 4px 14px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255, 255, 255, 0.18)"
        transition="transform 120ms ease-out, filter 120ms ease-out"
        _hover={{ filter: "brightness(1.08)", transform: "translateY(-1px)" }}
        _active={{ transform: "translateY(0)" }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "blue.fg",
          outlineOffset: "2px",
        }}
      >
        <Icon boxSize={3.5}>
          <ArrowUp strokeWidth={2.5} />
        </Icon>
        <Text textStyle="xs" fontWeight="semibold" letterSpacing="tight">
          {count > 99 ? "99+" : count} new
        </Text>
      </Flex>
    </Box>
  );
};
