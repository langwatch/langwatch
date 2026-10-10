/** What licensing lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  ResourceLimitRowToken,
  type ResourceLimitRowProps,
} from "@langwatch/enterprise-licensing-client";

/** Licensing's usage-against-limit row, rendered as licensing lends it. */
export function ResourceLimitRow(props: ResourceLimitRowProps) {
  return <Lent of={ResourceLimitRowToken} props={props} />;
}
