import { LinkedStat as OpsLinkedStat } from "./dashboard-linked-stat";
import type { LinkedStatProps } from "./dashboard-linked-stat";
import { OpsNextLink as NextLink } from "../../../../ui/elements/ops-link";

/** App router adapter for the reusable Ops stat tile. */
export function LinkedStat(props: LinkedStatProps) {
  return (
    <OpsLinkedStat
      {...props}
      link={(content, href) => (
        <NextLink href={href} style={{ textDecoration: "none" }}>
          {content}
        </NextLink>
      )}
    />
  );
}
