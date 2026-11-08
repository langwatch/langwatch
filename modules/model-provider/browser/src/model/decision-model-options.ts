/**
 * What the Default models pickers list and in what order, as pure functions.
 * Contract: specs/model-providers/instant-evals-decision-model.feature (ADR-182),
 *           specs/model-providers/judge-default-model.feature.
 */

import {
  DECISION_MODELS,
  decisionModelPickerTitle,
  findDecisionModel,
  findModelProviderDefinition,
  isOwnDecisionModelId,
  LANGWATCH_DECISION_MODEL_ID,
  LANGWATCH_DECISION_PREVIEWS,
  type BuiltInModel,
  type DecisionModelEntry,
  type LangWatchDecisionPreview,
  type ModelPickerOption,
  type ModelRole,
} from "@langwatch/model-provider-contract";

/** Every decision model's picker title keyed by its id, for a chip or row beside its icon. */
export const DECISION_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  DECISION_MODELS.map((entry) => [entry.id, decisionModelPickerTitle(entry)]),
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
  const label = decisionModelPickerTitle(entry);
  if (offered.has(entry.id)) return { label, value: entry.id, subtitle: entry.description };
  return {
    label,
    value: entry.id,
    subtitle: addKeyHint(entry.provider),
    disabled: true,
  };
}

/** The tag on a LangWatch decision model that has no model behind it yet. */
const COMING_SOON_HINT = "Coming soon";

/**
 * LangWatch's decision models in the Instant Evals picker: pickable where the catalogue says it
 * fills the column, otherwise listed as coming soon. The judge router flag (ADR-190) shows the
 * rest; off, only the ones that fill the column are listed.
 */
function langwatchDecisionOptions({
  isJudgeRouted,
}: {
  isJudgeRouted: boolean;
}): ModelPickerOption[] {
  const fillsColumn = (preview: LangWatchDecisionPreview) =>
    preview.fills.includes("INSTANT_EVALS");
  const shown = LANGWATCH_DECISION_PREVIEWS.filter(
    (preview) => isJudgeRouted || fillsColumn(preview),
  );
  return shown.map((preview) => {
    const isRouted = isJudgeRouted && preview.id === LANGWATCH_DECISION_MODEL_ID;
    const option = {
      label: preview.label,
      value: preview.id,
      subtitle: isRouted ? ROUTED_HOSTED_DECISION_MODEL_SUBTITLE : preview.description,
    };
    if (fillsColumn(preview)) return option;
    return { ...option, disabled: true, hint: COMING_SOON_HINT };
  });
}

/** The own-key catalogue in order, while own models are on and the server has answered. */
function ownDecisionOptions({
  pickable,
  isOwnModelEnabled,
}: {
  pickable: readonly BuiltInModel[] | undefined;
  isOwnModelEnabled: boolean;
}): ModelPickerOption[] {
  if (!isOwnModelEnabled || pickable === undefined) return [];
  const offered = new Set(pickable.map((model) => model.value));
  return DECISION_MODELS.filter((entry) => isOwnDecisionModelId(entry.id)).map((entry) =>
    ownModelOption({ entry, offered }),
  );
}

/**
 * The decision model picker: LangWatch's models first, then the own-key catalogue in order. Only
 * what the server says would run can be picked; with own models on, the rest say which key to
 * add. `pickable` undefined means not loaded (or no scope picked), so no own models yet.
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
  return [
    ...langwatchDecisionOptions({ isJudgeRouted }),
    ...ownDecisionOptions({ pickable, isOwnModelEnabled }),
  ];
}

/**
 * One column's picker. Instant Evals lists decision models only; every other column, Judge
 * included, lists the LLMs (ADR-182).
 */
export function rolePickerOptions({
  role,
  decisionOptions,
  llmOptions,
}: {
  role: ModelRole;
  decisionOptions: ModelPickerOption[];
  llmOptions: ModelPickerOption[];
}): ModelPickerOption[] {
  return role === "INSTANT_EVALS" ? decisionOptions : llmOptions;
}
