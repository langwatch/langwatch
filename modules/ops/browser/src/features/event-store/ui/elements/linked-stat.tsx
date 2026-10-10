import { Link as RoutedLink } from "@langwatch/browser-host/link";

import { LinkedStat as OpsLinkedStat } from "./dashboard-linked-stat.tsx";
import type { LinkedStatProps } from "./dashboard-linked-stat.tsx";

/** App router adapter for the reusable Ops stat tile. */
export function LinkedStat(props: LinkedStatProps) {
  return (
    <OpsLinkedStat
      {...props}
      link={(content, href) => (
        <RoutedLink href={href} style={{ textDecoration: "none" }}>
          {content}
        </RoutedLink>
      )}
    />
  );
}
