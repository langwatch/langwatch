/** What scenario lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  ParameterLineFieldToken,
  type ParameterLineFieldProps,
} from "@langwatch/scenario-contract";

/** Scenario's parameter line, rendered as scenario lends it. */
export function ParameterLineField(props: ParameterLineFieldProps) {
  return <Lent of={ParameterLineFieldToken} props={props} />;
}
