/**
 * Provider that ticks every `intervalMs` and makes the current time
 * available to all descendants via `useNow()`.
 */
import { createContext, useContext, useEffect, useState } from "react";

export const NowContext = createContext<number>(Date.now());

export function useNow(): number {
  return useContext(NowContext);
}

const DEFAULT_INTERVAL_MS = 60_000;

export function NowProvider({
  intervalMs = DEFAULT_INTERVAL_MS,
  children,
}: {
  intervalMs?: number;
  children: React.ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return <NowContext value={now}>{children}</NowContext>;
}
