/** What trace lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  SetupWithAgentButtonToken,
  type SetupWithAgentButtonProps,
} from "@langwatch/trace-contract";

/** Trace's "Setup via Agent" menu, rendered as trace lends it. */
export function SetupWithAgentButton(props: SetupWithAgentButtonProps) {
  return <Lent of={SetupWithAgentButtonToken} props={props} />;
}
