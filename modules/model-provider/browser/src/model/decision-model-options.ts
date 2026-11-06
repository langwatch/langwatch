/**
 * What the Default models pickers list and in what order, as pure functions.
 * Contract: specs/model-providers/instant-evals-decision-model.feature (ADR-182),
 *           specs/model-providers/judge-default-model.feature.
 */

import {
  DECISION_MODELS,
  findDecisionModel,
  findModelProviderDefinition,
  LANGWATCH_DECISION_MODEL_ID,
  type BuiltInModel,
  type DecisionModelEntry,
  type ModelPickerOption,
  type ModelRole,
} from "@langwatch/model-provider-contract";

/** Every decision model's label keyed by its id, so a chip or picker shows the label. */
export const DECISION_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  DECISION_MODELS.map((entry) => [entry.id, entry.label]),
);

/** Evals Preview's line when the judge router answers for it (ADR-190). */
export const ROUTED_HOSTED_DECISION_MODEL_SUBTITLE = "Optimized for evals, routed";

/** Whether the column can show a stored id; an id the catalogue dropped reads as unset. */
export function isShownDecisionModel(id: string | null | undefined): id is string {
  return !!id && !!findDecisionModel(id);
}

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
  if (offered.has(entry.id)) {
    return { label: entry.label, value: entry.id, subtitle: entry.description };
  }
  return {
    label: entry.label,
    value: entry.id,
    subtitle: addKeyHint(entry.provider),
    disabled: true,
  };
}

/**
 * The decision model picker: Evals Preview first, then the catalogue in order. Only what the
 * server says would run can be picked; with own models on, the rest are listed unpickable with a
 * hint. `pickable` undefined means not loaded (or no scope picked), so Evals Preview alone.
 */
export function decisionModelPickerOptions({
  pickable,
  isJudgeRouted,
  isOwnModelEnabled,
}: {
  pickable: readonly BuiltInModel[] | undefined;
  isJudgeRouted: boolean;
  isOwnModelEnabled: boolean;
}): ModelPickerOption[] {
  const offered = new Set((pickable ?? []).map((model) => model.value));
  const listsOwnModels = isOwnModelEnabled && pickable !== undefined;
  return DECISION_MODELS.flatMap((entry): ModelPickerOption[] => {
    if (entry.id === LANGWATCH_DECISION_MODEL_ID) {
      const subtitle = isJudgeRouted ? ROUTED_HOSTED_DECISION_MODEL_SUBTITLE : entry.description;
      return [{ label: entry.label, value: entry.id, subtitle }];
    }
    return listsOwnModels ? [ownModelOption({ entry, offered })] : [];
  });
}

/**
 * Every role picker lists decision models before LLMs; Instant Evals lists decision models only.
 * Which of them a role may hold stays the contract's role rule, applied where the row is drawn.
 */
export function rolePickerModels({
  role,
  decisionModels,
  llmModels,
}: {
  role: ModelRole;
  decisionModels: readonly string[];
  llmModels: readonly string[];
}): string[] {
  return role === "INSTANT_EVALS" ? [...decisionModels] : [...decisionModels, ...llmModels];
}
