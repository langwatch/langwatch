/**
 * What the Instant Evals column of Default models offers and shows, as pure functions.
 * Contract: specs/model-providers/instant-evals-decision-model.feature (ADR-182).
 */

import {
  DECISION_MODELS,
  findDecisionModel,
  LANGWATCH_DECISION_MODEL_ID,
  type BuiltInModel,
  type ModelPickerOption,
} from "@langwatch/model-provider-contract";

/** Every decision model's label keyed by its id, so a chip or picker shows the label. */
export const DECISION_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  DECISION_MODELS.map((entry) => [entry.id, entry.label]),
);

/** Whether the column can show a stored id; an id the catalogue dropped reads as unset. */
export function isShownDecisionModel(id: string | null | undefined): id is string {
  return !!id && !!findDecisionModel(id);
}

/**
 * The column's picker entries: exactly the decision models the server says would run for the
 * project, in catalogue order, LangWatch Instant Preview first. The server weighs the flag and
 * the keys, so a pick here always runs. `pickable` undefined means not loaded yet.
 */
export function decisionModelPickerOptions({
  pickable,
}: {
  pickable: readonly BuiltInModel[] | undefined;
}): ModelPickerOption[] {
  const offered = new Set((pickable ?? []).map((model) => model.value));
  return DECISION_MODELS.filter(
    (entry) => entry.id === LANGWATCH_DECISION_MODEL_ID || offered.has(entry.id),
  ).map((entry) => ({ label: entry.label, value: entry.id, subtitle: entry.description }));
}
