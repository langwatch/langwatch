/**
 * The Model Provider drawers, mounted in the host their package asks for.
 * All three close themselves, so this file is only the host wrapper — which
 * name each drawer answers to, and which host is mounted above it.
 */

import {
  DefaultModelOverrideDrawer as DefaultModelOverride,
  EditModelProviderDrawer as EditModelProvider,
  LLMModelCostDrawer as LLMModelCost,
} from "@langwatch/model-provider-web/drawers";

import { withHost } from "../../../../ui/sections/ui-page";
import { ModelProviderHost } from "./model-provider-host";

/** `llmModelCost`: four optional params — `id` edits, `cloneModel` seeds,
 * `prefillModel`/`prefillRegex` from trace drawer's unmapped cost; none means add. */
export const LLMModelCostDrawer = withHost(ModelProviderHost, LLMModelCost);

/** `defaultModelOverride`: `editingId` names policy being edited (absent = Add case);
 * reads from table snapshot, no round trip. */
export const DefaultModelOverrideDrawer = withHost(ModelProviderHost, DefaultModelOverride);

/**
 * `editModelProvider`. `providerKey` (required) picks which credential
 * fields render; `modelProviderId` narrows to one row, or the Add flow's
 * `"new"` sentinel. A provider belongs to the organization, not a project.
 */
export const EditModelProviderDrawer = withHost(ModelProviderHost, EditModelProvider);
