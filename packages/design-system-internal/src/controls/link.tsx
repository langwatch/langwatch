import type { ReactNode } from "react";

import { flag } from "../class-names.ts";
import { IconArrowUpRight } from "../icons.tsx";

export type LinkProps = {
  href: string;
  children: ReactNode;
  /** Opens in a new tab and shows an arrow saying so. */
  external?: boolean;
  /** For a hostname or a path. */
  mono?: boolean;
  title?: string;
};

export const Link = ({ href, children, external = false, mono = false, title }: LinkProps) => (
  <a
    className="ds-link"
    href={href}
    data-mono={flag({ on: mono })}
    title={title ?? (typeof children === "string" ? children : undefined)}
    target={external ? "_blank" : undefined}
    rel={external ? "noopener noreferrer" : undefined}
  >
    <span className="ds-link-text">{children}</span>
    {external && (
      <>
        <span className="ds-link-arrow">
          <IconArrowUpRight />
        </span>
        <span className="ds-visually-hidden"> (opens in a new tab)</span>
      </>
    )}
  </a>
);
