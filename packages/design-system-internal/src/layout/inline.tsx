import type { ReactNode } from "react";

import { flag, joinClasses } from "../class-names.ts";
import type { Gap } from "./stack.tsx";

export type InlineProps = {
  children: ReactNode;
  gap?: Gap;
  align?: "start" | "center" | "end" | "baseline" | "stretch";
  justify?: "start" | "center" | "between" | "end";
  wrap?: boolean;
  as?: "div" | "header" | "footer" | "nav";
  /** Layout glue from the console's own app.css; never colour or type. */
  className?: string;
};

export const Inline = ({
  children,
  gap = 2,
  align = "center",
  justify,
  wrap = false,
  as: Element = "div",
  className,
}: InlineProps) => (
  <Element
    className={joinClasses({ names: ["ds-inline", `ds-gap-${gap}`, className] })}
    data-align={align}
    data-justify={justify}
    data-wrap={flag({ on: wrap })}
  >
    {children}
  </Element>
);

/** Takes the free space in an `Inline`, pushing what follows to the end. */
export const Spacer = () => <div data-grow="" aria-hidden="true" />;
