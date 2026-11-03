/** The clock a countdown reads, ticking each second while `running`; it never calls the server. */

import { nowInstant } from "@langwatch/time";
import { useEffect, useState } from "react";

export function useNowMs({ running }: { running: boolean }): number {
  const [nowMs, setNowMs] = useState(() => nowInstant().epochMilliseconds);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNowMs(nowInstant().epochMilliseconds), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return nowMs;
}
