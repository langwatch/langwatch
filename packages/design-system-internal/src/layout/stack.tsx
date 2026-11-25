import type { ReactNode } from "react";

import { joinClasses } from "../class-names.ts";

/** Steps of the 4px spacing scale a layout gap may take. */
export type Gap = 1 | 2 | 3 | 4 | 5 | 6 | 8 | 12;

export type StackProps = {
  children: ReactNode;
  gap?: Gap;
  align?: "start" | "center" | "end" | "stretch";
  as?: "div" | "section" | "header" | "footer";
  /** Layout glue from the console's own app.css; never colour or type. */
  className?: string;
};

export const Stack = ({ children, gap = 4, align, as: Element = "div", className }: StackProps) => (
  <Element
    className={joinClasses({ names: ["ds-stack", `ds-gap-${gap}`, className] })}
    data-align={align}
  >
    {children}
  </Element>
);
