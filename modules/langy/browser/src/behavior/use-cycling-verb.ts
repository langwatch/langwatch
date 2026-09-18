import { useReducedMotion } from "@langwatch/langy-browser-kit";
import { useEffect, useState } from "react";

export function useCyclingVerb(
  active: boolean,
  verbs: readonly string[],
  intervalMs: number,
): string {
  const reduceMotion = useReducedMotion();
  const [verb, setVerb] = useState(verbs[0] ?? "");

  useEffect(() => {
    if (!active || reduceMotion) {
      return;
    }

    let index = 0;
    const interval = window.setInterval(() => {
      index = (index + 1) % verbs.length;
      setVerb(verbs[index] ?? "");
    }, intervalMs);

    return () => window.clearInterval(interval);
  }, [active, intervalMs, reduceMotion, verbs]);

  return verb;
}
