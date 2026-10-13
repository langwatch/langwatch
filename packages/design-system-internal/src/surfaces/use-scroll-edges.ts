import { useLayoutEffect, useState, type RefObject } from "react";

export type ScrollEdges = { start: boolean; end: boolean };

const edgesOf = ({ element, axis }: { element: HTMLElement; axis: "x" | "y" }): ScrollEdges =>
  axis === "x"
    ? {
        start: element.scrollLeft > 1,
        end: element.scrollLeft + element.clientWidth < element.scrollWidth - 1,
      }
    : {
        start: element.scrollTop > 1,
        end: element.scrollTop + element.clientHeight < element.scrollHeight - 1,
      };

/**
 * Which edges of a scroller have more past them, kept current on scroll and on
 * resize of the scroller or its children; `watch` re-reads when content changes.
 */
export const useScrollEdges = ({
  ref,
  axis,
  watch,
}: {
  ref: RefObject<HTMLElement | null>;
  axis: "x" | "y";
  watch?: unknown;
}): ScrollEdges => {
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const measure = () => {
      const next = edgesOf({ element, axis });
      setEdges((last) => (last.start === next.start && last.end === next.end ? last : next));
    };
    measure();
    element.addEventListener("scroll", measure, { passive: true });
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    for (const child of element.children) observer?.observe(child);
    return () => {
      element.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [ref, axis, watch]);
  return edges;
};
