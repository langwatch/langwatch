import { motion } from "motion/react";
import type React from "react";
import { useEffect, useState } from "react";
import { useFreshnessSignal } from "../../stores/freshnessSignal";
import { AuroraSvg } from "./AuroraSvg";

const FADE_MASK =
  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%)";

interface RefreshProgressBarProps {
  /** Render even when not refreshing — for dev-mode preview. */
  forceVisible?: boolean;
}

const WELCOME_BOOM_DURATION_MS = 1500;

export const RefreshProgressBar: React.FC<RefreshProgressBarProps> = ({
  forceVisible,
}) => {
  const isRefreshing = useFreshnessSignal((s) => s.isRefreshing);

  // Capture the welcome-boom flag once when the bar mounts and clear it,
  // so the dramatic swell only plays for the welcome flow. Every subsequent
  // refresh gets the mild fade. Holding `boomActive` true for a fixed
  // duration keeps the bar visible even if the underlying refetch resolves
  // sooner — otherwise the aurora vanishes mid-swell.
  const [boomed] = useState(
    () => useFreshnessSignal.getState().welcomeBoom,
  );
  const [boomActive, setBoomActive] = useState(boomed);
  const setWelcomeBoom = useFreshnessSignal((s) => s.setWelcomeBoom);
  useEffect(() => {
    if (!boomed) return;
    setWelcomeBoom(false);
    const timer = window.setTimeout(
      () => setBoomActive(false),
      WELCOME_BOOM_DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [boomed, setWelcomeBoom]);

  const active = (forceVisible ?? isRefreshing) || boomActive;
  if (!active) return null;

  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0, height: boomed ? 600 : 200 }}
      animate={{ opacity: 1, height: 200 }}
      transition={
        boomed
          ? {
              opacity: { duration: 0.35, ease: "easeOut" },
              height: { duration: 1.3, ease: [0.16, 1, 0.3, 1] },
            }
          : { opacity: { duration: 0.4, ease: "easeOut" } }
      }
      style={{
        position: "absolute",
        top: "-90px",
        left: 0,
        right: 0,
        pointerEvents: "none",
        zIndex: 3,
        overflow: "hidden",
        maskImage: FADE_MASK,
        WebkitMaskImage: FADE_MASK,
      }}
    >
      <AuroraSvg />
    </motion.div>
  );
};
