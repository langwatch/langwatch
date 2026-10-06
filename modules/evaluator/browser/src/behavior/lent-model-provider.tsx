/** What model-provider lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  ModelDisplayToken,
  ModelSelectorToken,
  type ModelDisplayProps,
  type ModelSelectorProps,
} from "@langwatch/model-provider-contract";

/** Model-provider's display of one chosen model, rendered as model-provider lends it. */
export function LLMModelDisplay(props: ModelDisplayProps) {
  return <Lent of={ModelDisplayToken} props={props} />;
}

/** Model-provider's model picker, rendered as model-provider lends it. */
export function ModelSelector(props: ModelSelectorProps) {
  return <Lent of={ModelSelectorToken} props={props} />;
}
