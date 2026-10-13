import { useCallback, useEffect, useState } from "react";

export function useFindMatchCycling(matches: string[]): {
  currentIndex: number;
  currentId: string | null;
  next: () => void;
  previous: () => void;
} {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    setCurrentIndex(0);
  }, [matches]);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((index) => (index + 1) % matches.length);
  }, [matches.length]);

  const previous = useCallback(() => {
    if (matches.length === 0) return;
    setCurrentIndex((index) => (index - 1 + matches.length) % matches.length);
  }, [matches.length]);

  return {
    currentIndex,
    currentId: matches[currentIndex] ?? null,
    next,
    previous,
  };
}
