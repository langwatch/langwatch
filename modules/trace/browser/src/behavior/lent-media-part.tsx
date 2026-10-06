/** What scenario lends this module by token (ARCHITECTURE.md §10, §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { MediaPartToken, type MediaPartProps } from "@langwatch/scenario-contract";

/** Scenario's media renderer, rendered as scenario lends it. */
export function LentMediaPart(props: MediaPartProps) {
  return <Lent of={MediaPartToken} props={props} />;
}
