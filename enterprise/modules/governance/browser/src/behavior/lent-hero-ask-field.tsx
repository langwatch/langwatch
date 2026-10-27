/** What project lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { HeroAskFieldToken } from "@langwatch/project-client";
import type { HeroAskFieldProps } from "@langwatch/project-contract";

/** Project's inline command palette, rendered as project lends it. */
export function HeroAskField(props: HeroAskFieldProps) {
  return <Lent of={HeroAskFieldToken} props={props} />;
}
