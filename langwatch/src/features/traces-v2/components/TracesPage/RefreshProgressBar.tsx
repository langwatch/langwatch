import { motion } from "motion/react";
import type React from "react";
import { useTraceListRefresh } from "../../hooks/useTraceListRefresh";
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
  // Two sources, OR-ed:
  //  - pulse: short fixed-duration flash for view switches and other
  //    transitions that don't kick a fetch (uiStore-driven).
  //  - isFetching: every in-flight tracesV2 list/discover/newCount
  //    query, tied directly to the React-Query cache. Without this the
  //    aurora cleared after the 900ms pulse even while a slow project
  //    was still mid-fetch, which read as "refresh failed silently."
  const pulsed = useRefreshUIStore((s) => s.isRefreshing);
  const { isRefreshing: fetching } = useTraceListRefresh();
  const active = forceVisible ?? (pulsed || fetching);
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
