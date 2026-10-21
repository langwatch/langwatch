/**
 * What the Instant Evals column of Default models offers and shows, as pure functions.
 * Contract: specs/model-providers/instant-evals-decision-model.feature (ADR-182).
 */

import {
  DECISION_MODELS,
  findDecisionModel,
  findModelProviderDefinition,
  LANGWATCH_DECISION_MODEL_ID,
  type ModelPickerOption,
} from "@langwatch/model-provider-contract";

/** Every decision model's label keyed by its id, so a chip or picker reads the label, not the id. */
export const DECISION_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  DECISION_MODELS.map((entry) => [entry.id, entry.label]),
);

/** Whether a stored id is one the column can show; an id the catalogue no longer offers reads as unset. */
export function isShownDecisionModel(id: string | null | undefined): id is string {
  return !!id && !!findDecisionModel(id);
}

function missingKeyHint(provider: string): string {
  const name = findModelProviderDefinition(provider)?.name ?? provider;
  const article = /^[aeiou]/i.test(name) ? "an" : "a";
  return `Add ${article} ${name} key in Model Providers first`;
}

/**
 * The column's picker entries, LangWatch Instant Preview first. Own entries need the
 * own-decision-model flag; one whose provider has no enabled row says how to add it.
 * `enabledProviderKeys` null means the rows have not loaded, so no hint is shown yet.
 */
export function decisionModelPickerOptions({
  ownModelsEnabled,
  enabledProviderKeys,
}: {
  ownModelsEnabled: boolean;
  enabledProviderKeys: ReadonlySet<string> | null;
}): ModelPickerOption[] {
  return DECISION_MODELS.filter(
    (entry) => entry.id === LANGWATCH_DECISION_MODEL_ID || ownModelsEnabled,
  ).map((entry) => {
    const needsKey =
      entry.id !== LANGWATCH_DECISION_MODEL_ID &&
      !!enabledProviderKeys &&
      !enabledProviderKeys.has(entry.provider);
    return {
      label: entry.label,
      value: entry.id,
      subtitle: needsKey ? missingKeyHint(entry.provider) : entry.description,
    };
  });
}
