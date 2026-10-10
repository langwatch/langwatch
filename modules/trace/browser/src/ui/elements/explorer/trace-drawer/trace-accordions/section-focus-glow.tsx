import { Box, Portal } from "@langwatch/design-system/primitives";
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
              0 0 0 0 transparent,
              0 0 0 0 transparent;
            border-color: transparent;
          }
          18% {
            box-shadow:
              0 0 0 2px color-mix(in srgb, var(--chakra-colors-blue-fg) 65%, transparent),
              0 0 28px 6px color-mix(in srgb, var(--chakra-colors-blue-fg) 42%, transparent);
            border-color: color-mix(in srgb, var(--chakra-colors-blue-fg) 85%, transparent);
          }
          100% {
            box-shadow:
              0 0 0 0 transparent,
              0 0 0 0 transparent;
            border-color: transparent;
          }
        }
        @keyframes tracesSectionFocusGlowDark {
          0% {
            box-shadow:
              0 0 0 0 transparent,
              0 0 0 0 transparent;
            border-color: transparent;
          }
          18% {
            box-shadow:
              0 0 0 2px color-mix(in srgb, var(--chakra-colors-blue-fg) 55%, transparent),
              0 0 28px 6px color-mix(in srgb, var(--chakra-colors-blue-fg) 40%, transparent);
            border-color: color-mix(in srgb, var(--chakra-colors-blue-fg) 85%, transparent);
          }
          100% {
            box-shadow:
              0 0 0 0 transparent,
              0 0 0 0 transparent;
            border-color: transparent;
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
