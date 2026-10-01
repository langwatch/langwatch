/** Full-page wait screen: logo static from the first frame, dissolving out on unmount. */
import { Box } from "@chakra-ui/react";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useReducedMotion } from "../use-reduced-motion.ts";
import { AmbientGround } from "./ambient-ground.tsx";
import { FullLogo } from "./full-logo.tsx";

/** How long the screen takes to dissolve off the page it was covering. */
const FADE_OUT_MS = 320;
const FADE_OUT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

/** `useLayoutEffect` warns when it runs on the server; this never does. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Every caller early-returns this screen, so there's nothing left for
 * `AnimatePresence` to animate an exit for. A layout-effect cleanup instead
 * pins a static copy over the page and dissolves that, with no bare frame.
 */
export const LoadingScreen = () => {
  const reduceMotion = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  // Read at unmount, so the cleanup never closes over a stale preference.
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useIsomorphicLayoutEffect(() => {
    return () => {
      const node = rootRef.current;
      if (!node || reduceMotionRef.current) return;
      // `Element.animate` is not implemented in jsdom, so a component test
      // rendering this must not fall over on the way out.
      if (typeof node.animate !== "function") return;

      const ghost = node.cloneNode(true) as HTMLElement;
      ghost.setAttribute("aria-hidden", "true");
      ghost.setAttribute("data-loading-screen-ghost", "");
      Object.assign(ghost.style, {
        position: "fixed",
        inset: "0",
        margin: "0",
        // Above the page it is uncovering, below anything modal.
        zIndex: "1400",
        // Inert on purpose: the live page underneath takes every click from
        // the first frame of the fade.
        pointerEvents: "none",
      });
      document.body.appendChild(ghost);

      const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: FADE_OUT_MS,
        easing: FADE_OUT_EASING,
        fill: "forwards",
      });
      const remove = () => ghost.remove();
      fade.onfinish = remove;
      // A tab backgrounded mid-fade can leave the animation unfinished; the
      // ghost must never outlive its welcome and cover the app.
      fade.oncancel = remove;
      window.setTimeout(remove, FADE_OUT_MS + 400);
    };
  }, []);

  // No entry fade and no delay: the logo is on screen at first paint, and
  // only the ambient ground's live shader fades in behind it.
  return (
    <Box
      ref={rootRef}
      data-testid="loading-screen"
      width="full"
      height="full"
      minHeight="100vh"
      bg="bg.page"
      position="relative"
      paddingBottom={16}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <AmbientGround />
      <Box position="relative" zIndex={1} data-testid="loading-screen-logo">
        <FullLogo width={155 * 1.2} height={38 * 1.2} />
      </Box>
    </Box>
  );
};
