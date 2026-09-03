import { useEffect, useMemo, useState } from "react";

/**
 * A rolling `[now - days, now)` window that keeps rolling.
 *
 * The obvious version computes `new Date()` once and freezes: a dashboard
 * left open overnight keeps asking for the window it was opened with, so
 * spend recorded since then never appears and the page looks a day behind
 * until somebody reloads it. The tick advances the end of the window on a
 * cadence, and quantising it to the minute keeps the query key stable
 * enough that this is a refetch a minute rather than one a render.
 */
export function useRollingWindow(range: number | "mtd", refreshMs = 60_000) {
  const [tick, setTick] = useState(() => quantiseToMinute(Date.now()));

  useEffect(() => {
    const id = setInterval(() => setTick(quantiseToMinute(Date.now())), refreshMs);
    return () => clearInterval(id);
  }, [refreshMs]);

  return useMemo(() => {
    const to = new Date(tick);
    // "mtd" anchors to the start of the current UTC month and keeps
    // advancing across a month boundary: it is the window the keys
    // table's "Spent this month" column is computed over, so the
    // click-through lands on the same total.
    const from =
      range === "mtd"
        ? new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1))
        : new Date(tick - range * 24 * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }, [range, tick]);
}

function quantiseToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}
