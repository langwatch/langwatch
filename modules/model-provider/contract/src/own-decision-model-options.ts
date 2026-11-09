/**
 * The own-key decision models as picker entries, shared by Settings › Default models and the
 * eval chip popover so both list them alike (ADR-182).
 */

import {
  DECISION_MODELS,
  decisionModelPickerTitle,
  isOwnDecisionModelId,
  type DecisionModelEntry,
} from "./catalog/decision-models.ts";
import type { ModelPickerOption } from "./model-options.ts";
import { findModelProviderDefinition } from "./model-provider-registry.ts";
import type { BuiltInModel } from "./model-selection.ts";

/** The line on a decision model whose provider has no key at the picked scopes. */
function addKeyHint(provider: string): string {
  const name = findModelProviderDefinition(provider)?.name ?? provider;
  const article = /^[aeiou]/i.test(name) ? "an" : "a";
  return `Add ${article} ${name} key in Model Providers to use it.`;
}

function ownModelOption({
  entry,
  offered,
}: {
  entry: DecisionModelEntry;
  offered: ReadonlySet<string>;
}): ModelPickerOption {
  const label = decisionModelPickerTitle(entry);
  if (offered.has(entry.id)) return { label, value: entry.id, subtitle: entry.description };
  return { label, value: entry.id, subtitle: addKeyHint(entry.provider), disabled: true };
}

/**
 * The own-key catalogue in order: what the server says would run (`pickable`) can be picked, the
 * rest say which key to add.
 */
export function ownDecisionModelPickerOptions(
  pickable: readonly BuiltInModel[],
): ModelPickerOption[] {
  const offered = new Set(pickable.map((model) => model.value));
  return DECISION_MODELS.filter((entry) => isOwnDecisionModelId(entry.id)).map((entry) =>
    ownModelOption({ entry, offered }),
  );
}
