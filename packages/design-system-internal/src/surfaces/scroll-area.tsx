import { useRef, type ReactNode } from "react";

import { flag, joinClasses } from "../class-names.ts";
import { useScrollEdges } from "./use-scroll-edges.ts";

export type ScrollAreaProps = {
  children: ReactNode;
  /** Names the region for assistive technology. */
  label?: string;
  /** Layout glue from the console's own app.css: the height it may grow to. */
  className?: string;
};

/**
 * A vertical scroller whose clipped edge fades, so a row cut at the edge reads
 * as "more below". As a panel's only child it is flush and carries the inset.
 */
export const ScrollArea = ({ children, label, className }: ScrollAreaProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges({ ref, axis: "y" });
  return (
    <div
      ref={ref}
      className={joinClasses({ names: ["ds-scroll", className] })}
      role={label === undefined ? undefined : "region"}
      aria-label={label}
      data-more-start={flag({ on: edges.start })}
      data-more-end={flag({ on: edges.end })}
    >
      {children}
    </div>
  );
};
