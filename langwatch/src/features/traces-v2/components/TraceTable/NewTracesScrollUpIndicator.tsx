import { Box, Flex, Text } from "@chakra-ui/react";
import { ChevronUp } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTraceNewCount } from "../../hooks/useTraceNewCount";

const SCROLL_THRESHOLD_PX = 80;

interface NewTracesScrollUpIndicatorProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Floating wavy-orb that appears when there are unacknowledged new traces
 * AND the user has scrolled away from the top of the table. Click scrolls
 * smoothly back to the top and acknowledges the count so it dismisses.
 *
 * The orb has two layered animations:
 *   - tracesV2OrbMorph: animates border-radius to give a fluid, organic shape
 *   - tracesV2OrbBob: a gentle scale + translate breathing motion
 */
export const NewTracesScrollUpIndicator: React.FC<
  NewTracesScrollUpIndicatorProps
> = ({ scrollRef }) => {
  const { count, acknowledge } = useTraceNewCount();
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setIsScrolled(el.scrollTop > SCROLL_THRESHOLD_PX);
    update();
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [scrollRef]);

  if (count === 0 || !isScrolled) return null;

  const handleClick = () => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    acknowledge();
  };

  return (
    <Box
      position="absolute"
      top="14px"
      left="50%"
      transform="translateX(-50%)"
      zIndex={6}
      pointerEvents="none"
    >
      <Flex
        as="button"
        onClick={handleClick}
        align="center"
        gap={1.5}
        paddingLeft={3}
        paddingRight={4}
        paddingY={2}
        cursor="pointer"
        color="white"
        pointerEvents="auto"
        role="status"
        aria-live="polite"
        aria-label={`${count} new trace${count === 1 ? "" : "s"} above — scroll up`}
        css={{
          background:
            "radial-gradient(circle at 30% 25%, rgba(147,197,253,0.95), rgba(37,99,235,0.78) 70%)",
          boxShadow:
            "0 6px 28px rgba(59,130,246,0.45), inset 0 0 0 1px rgba(255,255,255,0.18), inset 0 -8px 18px rgba(30,64,175,0.35)",
          backdropFilter: "blur(6px)",
          animation:
            "tracesV2OrbMorph 5.5s ease-in-out infinite, tracesV2OrbBob 2.6s ease-in-out infinite",
          "@keyframes tracesV2OrbMorph": {
            "0%, 100%": {
              borderRadius: "60% 40% 55% 45% / 50% 60% 40% 50%",
            },
            "25%": {
              borderRadius: "44% 56% 68% 32% / 52% 42% 58% 48%",
            },
            "50%": {
              borderRadius: "52% 48% 30% 70% / 60% 50% 50% 40%",
            },
            "75%": {
              borderRadius: "70% 30% 48% 52% / 40% 62% 48% 60%",
            },
          },
          "@keyframes tracesV2OrbBob": {
            "0%, 100%": { transform: "scale(1)" },
            "50%": { transform: "scale(1.05)" },
          },
          transition: "filter 180ms ease-out",
        }}
        _hover={{ filter: "brightness(1.1)" }}
        _focusVisible={{
          outline: "2px solid",
          outlineColor: "blue.fg",
          outlineOffset: "2px",
        }}
      >
        <ChevronUp size={14} strokeWidth={2.5} />
        <Text textStyle="xs" fontWeight="semibold" letterSpacing="tight">
          {count} new
        </Text>
      </Flex>
    </Box>
  );
};
