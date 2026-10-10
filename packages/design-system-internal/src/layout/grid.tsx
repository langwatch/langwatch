import type { ReactNode } from "react";

import { joinClasses } from "../class-names.ts";
import type { Gap } from "./stack.tsx";

export type GridProps = {
  children: ReactNode;
  /** A fixed column count; collapses to one column under 720px. */
  columns?: 1 | 2 | 3 | 4;
  /** Instead of `columns`: as many columns as fit at this minimum width (200/280/360px). */
  min?: "sm" | "md" | "lg";
  gap?: Gap;
  /** Layout glue from the console's own app.css; never colour or type. */
  className?: string;
};

export const Grid = ({ children, columns, min, gap = 4, className }: GridProps) => (
  <div
    className={joinClasses({ names: ["ds-grid", `ds-gap-${gap}`, className] })}
    data-columns={min ? undefined : columns}
    data-min={min}
  >
    {children}
  </div>
);
