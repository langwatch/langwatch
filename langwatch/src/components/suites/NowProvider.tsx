/**
 * Provider that ticks every `intervalMs` and makes the current time
 * available to all descendants via `useNow()`.
 */
import { useEffect, useState } from "react";
import { NowContext } from "~/hooks/useNow";

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
