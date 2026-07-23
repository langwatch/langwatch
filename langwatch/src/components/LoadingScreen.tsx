import { Box } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import { FullLogo } from "./icons/FullLogo";

let logoVisibleOnce = false;

/** How long the screen takes to dissolve off the page it was covering. */
const FADE_OUT_MS = 320;
const FADE_OUT_EASING = "cubic-bezier(0.4, 0, 0.2, 1)";

/** `useLayoutEffect` warns when it runs on the server; this never does. */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * The wait, and its way out.
 *
 * Every caller of this screen early-returns it — `if (loading) return
 * <LoadingScreen />` — so the moment loading ends React simply deletes it and
 * the page appears with a cut. A motion `exit` cannot help: motion only plays
 * an exit for a child of `AnimatePresence`, because something has to keep the
 * element in the tree while it leaves, and an early return keeps nothing.
 * Wiring thirteen call sites into keyed presences to buy one fade is a lot of
 * blast radius for a transition.
 *
 * So the screen sees itself out. On the way out it leaves a copy of its own
 * rendered self pinned over the page and dissolves that instead — the real
 * element is already gone, the copy is inert, and the page underneath is fully
 * live and interactive the whole time. The copy is made in a LAYOUT effect
 * cleanup, which runs in the same commit that removes the original and before
 * the browser paints, so there is never a frame with neither on screen.
 *
 * The result is the thing that was actually wanted: the app is revealed from
 * under the loading screen, rather than replacing it.
 */
export const LoadingScreen = () => {
  const reduceMotion = useReducedMotion();
  const [showLogo, setShowLogo] = useState(logoVisibleOnce);
  const rootRef = useRef<HTMLDivElement>(null);
  // Read at unmount, so the cleanup never closes over a stale preference.
  const reduceMotionRef = useRef(reduceMotion);
  reduceMotionRef.current = reduceMotion;

  useEffect(() => {
    setTimeout(() => {
      setShowLogo(true);
      setTimeout(() => {
        logoVisibleOnce = true;
      }, 500);
    }, 50);
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
      // No entry fade on a re-mount: once the logo has been seen, flashing the
      // whole page back up from zero on every subsequent wait is a wink, not a
      // transition.
      //
      // There is deliberately no `exit` here — it would never run. The way out
      // is the ghost in the layout-effect cleanup above, which is the only
      // thing that survives an early-returned unmount.
      initial={reduceMotion || logoVisibleOnce ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={
        reduceMotion ? { duration: 0 } : { duration: 0.2, ease: "easeOut" }
      }
    >
      <Box
        width="full"
        height="full"
        minHeight="100vh"
        // The console shell's ground: matches the flat workspace so the
        // load → shell swap doesn't flash a different color.
        bg="bg.surface"
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
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
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
