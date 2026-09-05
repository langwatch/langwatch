import { motion } from "motion/react";
import type React from "react";
import { useEffect } from "react";
import { useTraceListRefresh } from "../hooks/use-trace-list-refresh";
import { useRefreshUIStore } from "../../../../index";
import { AuroraSvg } from "../../../elements/explorer/traces-page/aurora-svg";

const FADE_MASK =
  "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 35%, rgba(0,0,0,0.7) 65%, transparent 100%)";

interface RefreshProgressBarProps {
  /** Render even when not refreshing — for dev-mode preview. */
  forceVisible?: boolean;
}

export const RefreshProgressBar: React.FC<RefreshProgressBarProps> = ({ forceVisible }) => {
  // Two sources, OR-ed: - pulse: short fixed-duration flash for arrival moments that don't kick a fetch (0→N
  // new-trace transition, view switches). - requested && fetching: an in-flight refetch, but ONLY when the
  // operator explicitly asked for it (refresh button, "N new" pill, tab return).
  const pulsed = useRefreshUIStore((s) => s.isRefreshing);
  const requested = useRefreshUIStore((s) => s.refreshRequested);
  const observeFetching = useRefreshUIStore((s) => s.observeFetching);
  const { isRefreshing: fetching } = useTraceListRefresh();
  // Pipe the live isFetching signal into the store; the request/settle lifecycle
  // (including the saw-a-fetch latch) lives in the store action, not here.
  useEffect(() => {
    observeFetching(fetching);
  }, [fetching, requested, observeFetching]);
  const active = forceVisible || pulsed || requested;
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
