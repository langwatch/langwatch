import { useEffect, useRef, useState } from "react";

const SPIN_DURATION_MS = 1000; // Matches animation-spinning duration in globals.scss

/**
 * Hook that ensures a spinning/loading state lasts at least one full animation cycle.
 * This provides better visual feedback when operations complete very quickly.
 *
 * @param isActuallyLoading - The actual loading state from the data source
 * @returns A boolean that stays true for at least SPIN_DURATION_MS after isActuallyLoading becomes true
 */
export const useMinimumSpinDuration = (isActuallyLoading: boolean): boolean => {
  const [isSpinning, setIsSpinning] = useState(false);
  const spinStartTimeRef = useRef<number | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isActuallyLoading && !isSpinning) {
      // Start spinning
      spinStartTimeRef.current = Date.now();
      setIsSpinning(true);
    } else if (!isActuallyLoading && isSpinning && spinStartTimeRef.current) {
      // Loading finished, but ensure minimum spin duration
      const elapsed = Date.now() - spinStartTimeRef.current;
      const remaining = SPIN_DURATION_MS - elapsed;

      if (remaining > 0) {
        timeoutRef.current = setTimeout(() => {
          setIsSpinning(false);
          spinStartTimeRef.current = null;
        }, remaining);
      } else {
        setIsSpinning(false);
        spinStartTimeRef.current = null;
      }
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isActuallyLoading, isSpinning]);

  return isSpinning;
};
