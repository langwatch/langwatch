import { nowEpochMs } from "@langwatch/time";
import { useEffect, useState } from "react";

/** The clock in epoch ms, re-read every `everyMs` while mounted; no server read. */
export function useTickingNow({ everyMs }: { everyMs: number }): number {
  const [now, setNow] = useState(nowEpochMs);
  useEffect(() => {
    const timer = setInterval(() => setNow(nowEpochMs()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
