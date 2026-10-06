/** What scenario lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import { TalkToItPanelToken, type TalkToItPanelProps } from "@langwatch/scenario-contract";

/** Scenario's Talk to it call panel, rendered as scenario lends it. */
export function TalkToItPanel(props: TalkToItPanelProps) {
  return <Lent of={TalkToItPanelToken} props={props} />;
}
