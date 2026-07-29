import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
  type RefObject,
} from "react";

/**
 * useIsOverflowing
 *
 * Single Responsibility: Report whether a scroll container's content is wider
 * than the container itself.
 *
 * Measures the container, never its children, so nothing has to be hidden to
 * find out. Re-measures when the container resizes and whenever `watch`
 * changes — pass the thing whose change could alter the content width, such as
 * the number of tabs.
 */
export function useIsOverflowing(
  ref: RefObject<HTMLElement | null>,
  watch: unknown,
): boolean {
  const [isOverflowing, setIsOverflowing] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Sub-pixel layout rounds scrollWidth up against clientWidth, so a 1px
    // slack keeps a perfectly-fitting strip from reporting overflow.
    setIsOverflowing(el.scrollWidth - el.clientWidth > 1);
  }, [ref]);

  // Before paint, not after. A strip restored from the persisted store opens
  // with every tab already in it, and measuring in a plain effect would draw
  // one frame of un-crowded tabs before correcting itself.
  useLayoutEffect(() => {
    measure();
  }, [measure, watch]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, measure]);

  return isOverflowing;
}
