import type { ReactNode } from "react";

import { flag } from "./class-names.ts";

export type TextProps = {
  children: ReactNode;
  size?: "xs" | "sm" | "md" | "lg";
  tone?: "default" | "secondary" | "muted";
  weight?: "regular" | "medium" | "semibold";
  mono?: boolean;
  /** One line with an ellipsis; a string child becomes the `title` too. */
  truncate?: boolean;
  title?: string;
  as?: "span" | "p" | "div";
};

const fullValueOf = ({ children, truncate }: { children: ReactNode; truncate: boolean }) =>
  truncate && (typeof children === "string" || typeof children === "number")
    ? String(children)
    : undefined;

export const Text = ({
  children,
  size,
  tone = "default",
  weight = "regular",
  mono = false,
  truncate = false,
  title,
  as: Element = "span",
}: TextProps) => (
  <Element
    className="ds-text"
    data-size={size}
    data-tone={tone}
    data-weight={weight}
    data-mono={flag({ on: mono })}
    data-truncate={flag({ on: truncate })}
    title={title ?? fullValueOf({ children, truncate })}
  >
    {children}
  </Element>
);
