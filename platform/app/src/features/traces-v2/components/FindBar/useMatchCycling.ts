import { useCallback, useEffect, useState } from "react";

export function useMatchCycling(matches: string[]): {
  currentIndex: number;
  currentId: string | null;
  next: () => void;
  prev: () => void;
} {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setCurrentIndex(0);
  }, [matches]);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  return {
    currentIndex,
    currentId: matches[currentIndex] ?? null,
    next,
    prev,
  };
}
