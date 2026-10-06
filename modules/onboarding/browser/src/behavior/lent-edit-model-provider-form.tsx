/** What model-provider lends this module through its declaration (ARCHITECTURE.md §3.4, rule 7). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  EditModelProviderFormToken,
  type EditModelProviderFormProps,
} from "@langwatch/model-provider-contract";

/** Model-provider's credential form, rendered as model-provider lends it. */
export function LentEditModelProviderForm(props: EditModelProviderFormProps) {
  return <Lent of={EditModelProviderFormToken} props={props} />;
}
