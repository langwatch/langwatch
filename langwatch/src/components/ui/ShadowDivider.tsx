/** 1px border line + soft downward shadow. Optionally fades in based on scroll position. */

import { Box } from "@chakra-ui/react";
import { useEffect, useRef, useState } from "react";

export function ShadowDivider({
  scrollRef,
  fadeAfterPx = 100,
}: {
  /** When provided, the divider starts invisible and fades in as this element scrolls past `fadeAfterPx`. */
  scrollRef?: React.RefObject<HTMLElement | null>;
  /** Scroll distance (px) at which the divider reaches full opacity. Default: 100. */
  fadeAfterPx?: number;
} = {}) {
  const [opacity, setOpacity] = useState(scrollRef ? 0 : 1);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Use requestAnimationFrame loop to detect when the ref gets assigned,
  // then attach the scroll listener. This handles the case where ShadowDivider
  // renders before the scroll container mounts.
  useEffect(() => {
    if (!scrollRef) return;

    let rafId: number;
    let attached = false;

    const poll = () => {
      const el = scrollRef.current;
      if (!el) {
        rafId = requestAnimationFrame(poll);
        return;
      }

      attached = true;
      const handleScroll = () => {
        setOpacity(Math.min(el.scrollTop / fadeAfterPx, 1));
      };

      handleScroll();
      el.addEventListener("scroll", handleScroll, { passive: true });
      cleanupRef.current = () => el.removeEventListener("scroll", handleScroll);
    };

    rafId = requestAnimationFrame(poll);

    return () => {
      if (!attached) cancelAnimationFrame(rafId);
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [scrollRef, fadeAfterPx]);

  return (
    <Box width="full" flexShrink={0} position="relative" opacity={opacity} transition="opacity 0.15s ease-out">
      <Box
        width="full"
        height="1px"
        bg="border.muted"
      />
      <Box
        width="full"
        height="4px"
        background="linear-gradient(to bottom, var(--chakra-colors-border-muted), transparent)"
        opacity={0.4}
        position="absolute"
        zIndex={1}
      />
    </Box>
  );
}
