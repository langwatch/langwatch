/**
 * The Model Provider drawers, mounted in the host their package asks for.
 *
 * A DRAWER IS NOT A PAGE. The Model Costs screen is wrapped in the model
 * provider host by the route it answers; the cost editor opens OVER
 * whatever address the reader is on — the trace drawer's "this model has no
 * cost mapping" suggestion deep-links straight to it from the Trace Explorer —
 * so the host travels with the drawer rather than with the address.
 *
 * ALL THREE CLOSE THEMSELVES, so this file is nothing but the host wrapper.
 * `@langwatch/ui-drawer` is the drawer FRAMEWORK — the `?drawer.open=`
 * vocabulary, the navigation stack, the in-memory prop slots — and it names no
 * drawer, so the package depends on it directly the way
 * `@langwatch/experiment-web` does. What stays here is the only thing that is
 * genuinely composition: which name each drawer answers to, and which host is
 * mounted above it.
 */

import {
  DefaultModelOverrideDrawer as DefaultModelOverride,
  EditModelProviderDrawer as EditModelProvider,
  LLMModelCostDrawer as LLMModelCost,
} from "@langwatch/model-provider-web/drawers";

import { withHost } from "../../../../ui/sections/ui-page";
import { ModelProviderHost } from "./model-provider-host";

/**
 * `llmModelCost`, as the address spells it.
 *
 * Four parameters arrive on it and every one is optional: `drawer.id` edits a
 * stored rule, `drawer.cloneModel` seeds a new one from a registry default, and
 * `drawer.prefillModel` / `drawer.prefillRegex` are what the trace drawer's
 * unmapped-cost suggestion writes so the form opens already filled in. None of
 * them means "add a rule", which is the address with no parameters at all.
 */
export const LLMModelCostDrawer = withHost(ModelProviderHost,LLMModelCost);

/**
 * `defaultModelOverride`, as the address spells it.
 *
 * One parameter: `drawer.editingId` names the policy being edited, and its
 * absence is what the Default Models table's "+ Add config" means. The drawer
 * itself reads the policy out of the same snapshot the table behind it already
 * holds, so opening it costs no round trip.
 */
export const DefaultModelOverrideDrawer = withHost(ModelProviderHost,DefaultModelOverride);

/**
 * `editModelProvider`, as the address spells it.
 *
 * `drawer.providerKey` is the only required parameter: it says WHICH KIND of
 * provider is being configured, which is what decides the credential fields.
 * `drawer.modelProviderId` narrows that to one stored row — and the Add flow
 * writes the sentinel `"new"` there rather than omitting it, which the form
 * reads as "whichever row owns this provider type right now". The two tenant
 * handles are both optional because a provider belongs to the ORGANIZATION and
 * only reaches a project through the scopes attached to it, so an organization
 * with no project can still configure one.
 */
export const EditModelProviderDrawer = withHost(ModelProviderHost,EditModelProvider);
