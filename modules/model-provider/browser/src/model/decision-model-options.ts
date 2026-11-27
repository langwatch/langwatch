/**
 * What the Default models pickers list and in what order, as pure functions.
 * Contract: specs/model-providers/instant-evals-decision-model.feature (ADR-182),
 *           specs/model-providers/judge-default-model.feature.
 */

import type { ModelPickerAction } from "@langwatch/design-system/provider-model-selector";
import {
  DECISION_MODELS,
  decisionModelPickerTitle,
  findDecisionModel,
  isOwnDecisionModelId,
  LANGWATCH_DECISION_PREVIEWS,
  ownDecisionModelPickerOptions,
  type BuiltInModel,
  type LangWatchDecisionPreview,
  type ModelPickerOption,
  type ModelRole,
} from "@langwatch/model-provider-contract";

/** Every decision model's picker title keyed by its id, for a chip or row beside its icon. */
export const DECISION_MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  DECISION_MODELS.map((entry) => [entry.id, decisionModelPickerTitle(entry)]),
);

/** What an unset Instant Evals column reads where LangWatch Instant (preview) is not offered. */
export const CHOOSE_DECISION_MODEL = "Choose a decision model";

/** Offers that leave LangWatch's own model one switch away: the organization's, or its admin's. */
const HOSTED_ONE_SWITCH_AWAY: ReadonlySet<string> = new Set(["enable", "ask_admin"]);

/**
 * Whether the column may offer LangWatch Instant (preview): released, or one switch away. Not
 * answered yet counts as offered, so a released organization never sees it flicker to
 * "Choose a decision model".
 */
export function isHostedDecisionModelOffered(
  access: { hostedReleased: boolean; offer: string } | undefined,
): boolean {
  if (!access) return true;
  return access.hostedReleased || HOSTED_ONE_SWITCH_AWAY.has(access.offer);
}

/** Whether the column can show a stored id; an id the catalogue dropped reads as unset. */
export function isShownDecisionModel(id: string | null | undefined): id is string {
  return !!id && !!findDecisionModel(id);
}

/** The tag on a LangWatch decision model that has no model behind it yet. */
const COMING_SOON_HINT = "Coming soon";

/**
 * LangWatch's decision models in the Instant Evals picker: pickable where they fill the column,
 * else coming soon, shown only with the judge router flag (ADR-190). Never LangWatch Evals
 * (preview): only an LLM judge picks it, and nothing the column feeds is routed.
 */
function langwatchDecisionOptions({
  isJudgeRouted,
}: {
  isJudgeRouted: boolean;
}): ModelPickerOption[] {
  const fillsColumn = (preview: LangWatchDecisionPreview) =>
    preview.fills.includes("INSTANT_EVALS");
  const shown = LANGWATCH_DECISION_PREVIEWS.filter(
    (preview) => !preview.isJudgeRouter && (isJudgeRouted || fillsColumn(preview)),
  );
  return shown.map((preview) => {
    const option = { label: preview.label, value: preview.id, subtitle: preview.description };
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
  return ownDecisionModelPickerOptions(pickable);
}

/**
 * The decision model picker: LangWatch's models (when offered) first, then the own-key catalogue.
 * Only what the server says would run can be picked; with own models on, the rest say which key
 * to add. `pickable` undefined means not loaded (or no scope picked), so no own models yet.
 */
export function decisionModelPickerOptions({
  pickable,
  isJudgeRouted,
  isOwnModelEnabled,
  isHostedOffered = true,
}: {
  pickable: readonly BuiltInModel[] | undefined;
  isJudgeRouted: boolean;
  isOwnModelEnabled: boolean;
  isHostedOffered?: boolean;
}): ModelPickerOption[] {
  return [
    ...(isHostedOffered ? langwatchDecisionOptions({ isJudgeRouted }) : []),
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

/** A picker row that may carry a button, such as "Add key". */
export type DecisionPickerOption = ModelPickerOption & { action?: ModelPickerAction };

/** What an own decision model row's "Add key" button says. */
export const ADD_KEY_LABEL = "Add key";

/**
 * Gives every own decision model row that waits on a key an "Add key" button, which opens that
 * provider's form for the model. Rows that run, and LangWatch's own, are left as they are.
 */
export function withAddKeyActions({
  options,
  onAddKey,
}: {
  options: readonly ModelPickerOption[];
  onAddKey: (request: { provider: string; model: string }) => void;
}): DecisionPickerOption[] {
  return options.map((option) => {
    const provider = findDecisionModel(option.value)?.provider;
    if (!option.disabled || !provider || !isOwnDecisionModelId(option.value)) return option;
    const action = {
      label: ADD_KEY_LABEL,
      onAction: () => onAddKey({ provider, model: option.value }),
    };
    return { ...option, action };
  });
}

/** Whether `model` is a row the picker lets the reader pick now. */
export function isPickableDecisionOption({
  options,
  model,
}: {
  options: readonly ModelPickerOption[];
  model: string;
}): boolean {
  return options.some((option) => option.value === model && !option.disabled);
}
