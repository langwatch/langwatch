/**
 * The cue that a strip, a table or a list scrolls on: a fade over whichever edge still hides
 * content. `useScrollEdges` measures the scroller; `ScrollEdgeFade` sits beside it inside a
 * positioned box that does not scroll, so the fade stays on the edge.
 */
import { Box } from "@chakra-ui/react";
import { useLayoutEffect, useState } from "react";

type Axis = "x" | "y";
type Edges = { start: boolean; end: boolean };

/** Which ends of `axis` hide content; hand `ref` to the element that scrolls. */
export function useScrollEdges<T extends HTMLElement = HTMLDivElement>({
  axis = "x",
}: { axis?: Axis } = {}) {
  const [node, setNode] = useState<T | null>(null);
  const [edges, setEdges] = useState<Edges>({ start: false, end: false });

  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => {
      const offset = Math.abs(axis === "x" ? node.scrollLeft : node.scrollTop);
      const range =
        axis === "x" ? node.scrollWidth - node.clientWidth : node.scrollHeight - node.clientHeight;
      const start = offset > 1;
      const end = range - offset > 1;
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
    };
    measure();
    node.addEventListener("scroll", measure, { passive: true });
    if (typeof ResizeObserver === "undefined") {
      return () => node.removeEventListener("scroll", measure);
    }
    const resize = new ResizeObserver(measure);
    resize.observe(node);
    for (const child of Array.from(node.children)) resize.observe(child);
    return () => {
      node.removeEventListener("scroll", measure);
      resize.disconnect();
    };
  }, [node, axis]);

  return { ref: setNode, ...edges };
}

const PLACEMENT = {
  start: { top: 0, bottom: 0, left: 0, width: "6", bgGradient: "to-r" },
  end: { top: 0, bottom: 0, right: 0, width: "6", bgGradient: "to-l" },
  top: { top: 0, left: 0, right: 0, height: "6", bgGradient: "to-b" },
  bottom: { bottom: 0, left: 0, right: 0, height: "6", bgGradient: "to-t" },
} as const;

/**
 * A fade over one edge of a scroller, shown while content hides past it. `color` is the
 * surface the content sits on, so the fade reads as content running under the edge.
 */
export function ScrollEdgeFade({
  edge,
  visible,
  color = "bg",
}: {
  edge: keyof typeof PLACEMENT;
  visible: boolean;
  color?: string;
}) {
  return (
    <Box
      aria-hidden="true"
      data-scroll-fade={edge}
      data-visible={visible ? "true" : "false"}
      position="absolute"
      zIndex={2}
      pointerEvents="none"
      gradientFrom={color}
      gradientTo="transparent"
      opacity={visible ? 1 : 0}
      transition="opacity 160ms ease"
      _motionReduce={{ transition: "none" }}
      {...PLACEMENT[edge]}
    />
  );
}
