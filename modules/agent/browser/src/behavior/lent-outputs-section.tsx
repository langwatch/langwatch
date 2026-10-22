/** What prompt lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { OutputsSectionToken, type OutputsSectionProps } from "@langwatch/prompt-client";

/** Prompt's outputs editor (typed rows, JSON schema dialog), rendered as prompt lends it. */
export function OutputsSection(props: OutputsSectionProps) {
  return <Lent of={OutputsSectionToken} props={props} />;
}
