import { type RefObject, useCallback, useEffect, useLayoutEffect, useState } from "react";

export function useIsOverflowing(ref: RefObject<HTMLElement | null>, watch: unknown): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    // One pixel avoids sub-pixel rounding reporting a false overflow.
    setIsOverflowing(el.scrollWidth - el.clientWidth > 1);
  }, [ref]);

  useLayoutEffect(() => {
    measure();
  }, [measure, watch]);

  useEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    return () => observer.disconnect();
  }, [ref, measure]);

  return isOverflowing;
}
