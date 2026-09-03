/** Full-page wait screen with a ghost-on-unmount dissolve on the way out. */
import { Box } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "../use-reduced-motion";
import { FullLogo } from "./full-logo";

let logoVisibleOnce = false;

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
  const [showLogo, setShowLogo] = useState(logoVisibleOnce);
  const rootRef = useRef<HTMLDivElement>(null);
  // Read at unmount, so the cleanup never closes over a stale preference.
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    let logoSettledTimeout: ReturnType<typeof setTimeout> | undefined;
    const showLogoTimeout = setTimeout(() => {
      setShowLogo(true);
      logoSettledTimeout = setTimeout(() => {
        logoVisibleOnce = true;
      }, 500);
    }, 50);
    return () => {
      clearTimeout(showLogoTimeout);
      if (logoSettledTimeout) clearTimeout(logoSettledTimeout);
    };
  }, []);

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

  const fullLogo = <FullLogo width={155 * 1.2} height={38 * 1.2} />;

  return (
    <motion.div
      ref={rootRef}
      style={{ width: "100%", height: "100%", minHeight: "100vh" }}
      // No entry fade on remount (flashing back from zero repeatedly is a
      // wink). No `exit` either — it would never run; the ghost in the
      // layout-effect cleanup above is what survives an early-returned
      // unmount.
      initial={reduceMotion || logoVisibleOnce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }}
    >
      <Box
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
        {/* Orange mesh gradient background */}
        <Box
          position="absolute"
          inset={0}
          pointerEvents="none"
          overflow="hidden"
          zIndex={0}
          style={{
            contain: "layout paint",
            background: [
              "radial-gradient(ellipse 80% 50% at 50% -10%, rgba(237,137,38,0.06) 0%, transparent 70%)",
              "radial-gradient(ellipse 60% 40% at 70% 100%, rgba(237,137,38,0.02) 0%, transparent 60%)",
            ].join(", "),
          }}
        />

        <Box position="relative" zIndex={1}>
          {!logoVisibleOnce ? (
            <AnimatePresence>
              {showLogo && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {fullLogo}
                </motion.div>
              )}
            </AnimatePresence>
          ) : (
            fullLogo
          )}
        </Box>
      </Box>
    </motion.div>
  );
};
