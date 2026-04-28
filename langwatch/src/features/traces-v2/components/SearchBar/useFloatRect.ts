import type React from "react";
import { useLayoutEffect, useState } from "react";

export interface FloatRect {
  top: number;
  left: number;
  width: number;
}

/**
 * Tracks the bounding rect of a target element while `enabled`, updating on
 * resize and scroll. Returns `null` when disabled or before the first measure.
 */
export const useFloatRect = (
  ref: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): FloatRect | null => {
  const [rect, setRect] = useState<FloatRect | null>(null);

  useLayoutEffect(() => {
    if (!enabled) {
      setRect(null);
      return;
    }
    const update = () => {
      const node = ref.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [enabled, ref]);

  return rect;
};
