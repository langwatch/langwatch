import { motion } from "motion/react";
import type React from "react";
import { useRefreshUIStore } from "../../stores/refreshUIStore";
import { AuroraSvg } from "./AuroraSvg";

const FADE_MASK =
  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%)";

interface RefreshProgressBarProps {
  /** Render even when not refreshing — for dev-mode preview. */
  forceVisible?: boolean;
}

export const RefreshProgressBar: React.FC<RefreshProgressBarProps> = ({
  forceVisible,
}) => {
  const isRefreshing = useRefreshUIStore((s) => s.isRefreshing);
  const active = forceVisible ?? isRefreshing;
  if (!active) return null;

  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0, height: 200 }}
      animate={{ opacity: 1, height: 200 }}
      transition={{ opacity: { duration: 0.4, ease: "easeOut" } }}
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
