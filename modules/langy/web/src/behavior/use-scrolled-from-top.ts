import { useEffect, useRef, useState } from "react";

/**
 * Whether a scroll container has content scrolled off above its top edge.
 */
export function useScrolledFromTop(scrollRef: React.RefObject<HTMLElement | null>): boolean {
  const [isScrolledFromTop, setIsScrolledFromTop] = useState(false);
  const subscribedRef = useRef<HTMLElement | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // No dependency array on purpose: the guard is a cheap ref identity check,
  // and every commit is exactly when a swapped-in scroller can have appeared.
  useEffect(() => {
    const el = scrollRef.current;
    if (el === subscribedRef.current) return;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    subscribedRef.current = el;
    if (!el) {
      setIsScrolledFromTop(false);
      return;
    }
    // A pixel of slack: fractional zoom and smooth-scroll settling can leave
    // sub-pixel residue at the top, which must still count as "at the top".
    const update = () => setIsScrolledFromTop(el.scrollTop > 1);
    update();
    el.addEventListener("scroll", update, { passive: true });
    unsubscribeRef.current = () => el.removeEventListener("scroll", update);
  });

  useEffect(() => () => unsubscribeRef.current?.(), []);

  return isScrolledFromTop;
}
