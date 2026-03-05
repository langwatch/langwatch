import { useState, useEffect } from "react";
import { timeAgo } from "../utils/timeAgo.ts";

/**
 * Returns a timeAgo string that re-computes every 10 seconds,
 * so "5 minutes ago" doesn't get stale while the dashboard is open.
 */
export function useTickingTimeAgo(ms: number | null): string {
  const [text, setText] = useState(() => timeAgo(ms));

  useEffect(() => {
    setText(timeAgo(ms));
    if (!ms) return;

    const interval = setInterval(() => {
      setText(timeAgo(ms));
    }, 10_000);

    return () => clearInterval(interval);
  }, [ms]);

  return text;
}
