import { AnimatePresence, motion } from "motion/react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AuroraSvg } from "../TracesPage/AuroraSvg";

const FADE_MASK =
  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 40%, rgba(0,0,0,0.6) 70%, transparent 100%)";

interface NewSpanFlashProps {
  /** The current count of spans for the trace. A growth between renders triggers a flash. */
  spanCount: number;
  /** Resets the previous-count tracker so trace switches don't trigger a flash. */
  resetKey?: string | number | null;
}

/**
 * Brief aurora wash anchored at the top of the viz container. Fires for ~700ms
 * whenever the span count grows, signalling that the backend just streamed in
 * a new span.
 */
export const NewSpanFlash: React.FC<NewSpanFlashProps> = ({
  spanCount,
  resetKey,
}) => {
  const prevCount = useRef<number | null>(null);
  const prevResetKey = useRef<typeof resetKey>(resetKey);
  const [flashKey, setFlashKey] = useState(0);
  const [showing, setShowing] = useState(false);

  useEffect(() => {
    if (prevResetKey.current !== resetKey) {
      prevResetKey.current = resetKey;
      prevCount.current = spanCount;
      return;
    }
    if (prevCount.current === null) {
      prevCount.current = spanCount;
      return;
    }
    if (spanCount > prevCount.current) {
      setFlashKey((k) => k + 1);
      setShowing(true);
    }
    prevCount.current = spanCount;
  }, [spanCount, resetKey]);

  return (
    <AnimatePresence>
      {showing && (
        <motion.div
          key={flashKey}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.85, 0] }}
          transition={{ duration: 0.75, times: [0, 0.35, 1], ease: "easeOut" }}
          onAnimationComplete={() => setShowing(false)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 70,
            pointerEvents: "none",
            overflow: "hidden",
            zIndex: 4,
            maskImage: FADE_MASK,
            WebkitMaskImage: FADE_MASK,
          }}
        >
          <AuroraSvg idSuffix="newSpanFlash" />
        </motion.div>
      )}
    </AnimatePresence>
  );
};
