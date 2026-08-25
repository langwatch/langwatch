import { LinkedStat as OpsLinkedStat } from "@langwatch/ops-web";
import type { LinkedStatProps } from "@langwatch/ops-web";
import NextLink from "~/utils/compat/next-link";

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
