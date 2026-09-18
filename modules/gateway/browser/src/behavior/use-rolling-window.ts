import { Temporal, nowInstant, toDate } from "@langwatch/time";
import { useEffect, useMemo, useState } from "react";
/**
 * A rolling `[now - days, now)` window that ticks every minute to keep queries fresh.
 * Quantizing to the minute prevents unnecessary refetches on every render.
 */
export function useRollingWindow(range: number | "mtd", refreshMs = 60_000) {
  const [tick, setTick] = useState(() => quantiseToMinute(nowInstant().epochMilliseconds));

  useEffect(() => {
    const id = setInterval(
      () => setTick(quantiseToMinute(nowInstant().epochMilliseconds)),
      refreshMs,
    );
    return () => clearInterval(id);
  }, [refreshMs]);

  return useMemo(() => {
    const to = Temporal.Instant.fromEpochMilliseconds(tick);
    // "mtd" anchors to the start of the current UTC month and keeps
    // advancing across a month boundary: it is the window the keys
    // table's "Spent this month" column is computed over, so the
    // click-through lands on the same total.
    const from =
      range === "mtd"
        ? to.toZonedDateTimeISO("UTC").with({ day: 1 }).startOfDay().toInstant()
        : Temporal.Instant.fromEpochMilliseconds(tick - range * 24 * 60 * 60 * 1000);
    return { fromIso: toDate(from).toISOString(), toIso: toDate(to).toISOString() };
  }, [range, tick]);
}

function quantiseToMinute(ms: number): number {
  return Math.floor(ms / 60_000) * 60_000;
}
