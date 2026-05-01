import { useEffect, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

export const DEFAULT_THINKING_VERBS = [
  "Thinking about",
  "Pondering",
  "Researching",
  "Looking into",
  "Procrastinating about",
  "Mulling over",
  "Untangling",
  "Diving into",
];

export function useCyclingVerb(
  active: boolean,
  verbs: readonly string[],
): string {
  const reduceMotion = useReducedMotion();
  const [verb, setVerb] = useState(verbs[0] ?? "");
  useEffect(() => {
    if (!active || reduceMotion) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % verbs.length;
      setVerb(verbs[i] ?? "");
    }, 1800);
    return () => clearInterval(id);
  }, [active, reduceMotion, verbs]);
  return verb;
}
