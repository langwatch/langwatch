import { Box, Portal } from "@chakra-ui/react";
import { useEffect, useState } from "react";

/**
 * One-shot blue pulse painted as a Portal-rendered fixed-position overlay over a target
 * accordion section. The overlay measures the target's bounding rect on mount and
 * tracks it through scroll / resize for the duration of the animation.
 */
const GLOW_DURATION_MS = 1500;
const RECT_TRACK_FPS_INTERVAL_MS = 16;

export function SectionFocusGlow({
  target,
  nonce,
  onDone,
}: {
  target: HTMLElement;
  nonce: number;
  onDone: () => void;
}) {
  const [rect, setRect] = useState<DOMRect>(() => target.getBoundingClientRect());

  useEffect(() => {
    setRect(target.getBoundingClientRect());
    let raf = 0;
    let last = 0;
    const update = () => {
      const now = performance.now();
      if (now - last >= RECT_TRACK_FPS_INTERVAL_MS) {
        setRect(target.getBoundingClientRect());
        last = now;
      }
      raf = requestAnimationFrame(update);
    };
    raf = requestAnimationFrame(update);
    const done = window.setTimeout(onDone, GLOW_DURATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(done);
    };
  }, [target, nonce, onDone]);

  return (
    <Portal>
      <style>{`
        @keyframes tracesSectionFocusGlow {
          0% {
            box-shadow:
              0 0 0 0 rgba(59, 130, 246, 0),
              0 0 0 0 rgba(59, 130, 246, 0);
            border-color: rgba(59, 130, 246, 0);
          }
          18% {
            box-shadow:
              0 0 0 2px rgba(59, 130, 246, 0.65),
              0 0 28px 6px rgba(59, 130, 246, 0.42);
            border-color: rgba(59, 130, 246, 0.85);
          }
          100% {
            box-shadow:
              0 0 0 0 rgba(59, 130, 246, 0),
              0 0 0 0 rgba(59, 130, 246, 0);
            border-color: rgba(59, 130, 246, 0);
          }
        }
        @keyframes tracesSectionFocusGlowDark {
          0% {
            box-shadow:
              0 0 0 0 rgba(125, 211, 252, 0),
              0 0 0 0 rgba(125, 211, 252, 0);
            border-color: rgba(125, 211, 252, 0);
          }
          18% {
            box-shadow:
              0 0 0 2px rgba(125, 211, 252, 0.55),
              0 0 28px 6px rgba(125, 211, 252, 0.4);
            border-color: rgba(125, 211, 252, 0.85);
          }
          100% {
            box-shadow:
              0 0 0 0 rgba(125, 211, 252, 0),
              0 0 0 0 rgba(125, 211, 252, 0);
            border-color: rgba(125, 211, 252, 0);
          }
        }
        .traces-section-focus-glow {
          animation: tracesSectionFocusGlow ${GLOW_DURATION_MS}ms ease-out 1;
        }
        html.dark .traces-section-focus-glow {
          animation-name: tracesSectionFocusGlowDark;
        }
      `}</style>
      <Box
        key={nonce}
        className="traces-section-focus-glow"
        position="fixed"
        pointerEvents="none"
        zIndex={1600}
        borderWidth="1px"
        borderStyle="solid"
        borderRadius="6px"
        style={{
          top: `${rect.top}px`,
          left: `${rect.left}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
        }}
      />
    </Portal>
  );
}
