/** What model-provider lends this module by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import { ModelSelectorToken, type ModelSelectorProps } from "@langwatch/model-provider-contract";

/** Model-provider's model picker, rendered as model-provider lends it. */
export function ModelSelector(props: ModelSelectorProps) {
  return <Lent of={ModelSelectorToken} props={props} />;
}
