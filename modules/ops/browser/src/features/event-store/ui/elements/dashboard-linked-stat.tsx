import { Link } from "@langwatch/browser-host/link";
import { CompactStat, type CompactStatProps } from "@langwatch/design-system/stat-tile";
import type { ReactNode } from "react";

export type LinkedStatProps = Omit<CompactStatProps, "renderLink" | "children" | "value"> & {
  value: string;
  /** App/router-owned link wrapper; defaults to the host's in-app link. */
  link?: (content: ReactNode, href: string) => ReactNode;
};

/** The design system's compact stat, linked to an operator drill-down through the host. */
export function LinkedStat({ link, ...props }: LinkedStatProps) {
  return (
    <CompactStat
      {...props}
      renderLink={
        link ??
        ((content, href) => (
          <Link unstyled href={href} style={{ textDecoration: "none" }}>
            {content}
          </Link>
        ))
      }
    />
  );
}
