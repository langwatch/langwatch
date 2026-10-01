import { useLayoutEffect, useRef, useState } from "react";

/**
 * The undefined-variables banner overlays the textarea's bottom edge, so the
 * textarea reserves matching padding: measured, with 28px as the single-line
 * floor (also what jsdom, whose offsetHeight is always 0, falls back to).
 */
export function useBannerReservation(invalidVariables: string[]) {
  const bannerRef = useRef<HTMLDivElement>(null);
  const [bannerHeight, setBannerHeight] = useState(0);
  // Keyed on a primitive signature of the names, not the array's identity:
  // the array is rebuilt every render and would hit React's nested-update limit.
  const invalidVariablesKey = invalidVariables.join("\n");
  useLayoutEffect(() => {
    const node = bannerRef.current;
    if (!node) {
      setBannerHeight((prev) => (prev === 0 ? prev : 0));
      return;
    }
    const measure = () => {
      const measured = node.offsetHeight;
      setBannerHeight((prev) => (prev === measured ? prev : measured));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [invalidVariablesKey]);
  const reservedBottomPadding = invalidVariables.length > 0 ? Math.max(bannerHeight + 8, 28) : null;
  return { bannerRef, reservedBottomPadding };
}
