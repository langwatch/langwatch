/** What project lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import { HeroAskFieldToken, type HeroAskFieldProps } from "@langwatch/project-contract";

/** Project's inline command palette, rendered as project lends it. */
export function HeroAskField(props: HeroAskFieldProps) {
  return <Lent of={HeroAskFieldToken} props={props} />;
}
