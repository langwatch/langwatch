/**
 * What the Default models pickers list and in what order, as pure functions.
 * Contract: specs/model-providers/instant-evals-decision-model.feature (ADR-182),
 *           specs/model-providers/judge-default-model.feature.
 */

import {
  DECISION_MODELS,
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

import { MODEL_ROLE_LABEL } from "./default-model-cascade.ts";

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

/** The tag on a decision model listed in a column it cannot fill. */
function onlyFillsHint(fills: readonly ModelRole[]): string {
  return `${fills.map((role) => MODEL_ROLE_LABEL[role]).join(", ")} only`;
}

/** Why a LangWatch decision model is listed but cannot fill this column. */
function previewHint(preview: LangWatchDecisionPreview): string {
  if (preview.fills.length === 0) return "Coming soon";
  return onlyFillsHint(preview.fills);
}

/**
 * LangWatch's decision models in one column's picker: pickable where the catalogue says it fills
 * that column, otherwise listed with why not. The judge router flag (ADR-190) shows the rest;
 * off, only the ones that fill the column are listed.
 */
export function langwatchDecisionOptions({
  role,
  isJudgeRouted,
}: {
  role: ModelRole;
  isJudgeRouted: boolean;
}): ModelPickerOption[] {
  const shown = LANGWATCH_DECISION_PREVIEWS.filter(
    (preview) => isJudgeRouted || preview.fills.includes(role),
  );
  return shown.map((preview) => {
    const isRouted = isJudgeRouted && preview.id === LANGWATCH_DECISION_MODEL_ID;
    const option = {
      label: preview.label,
      value: preview.id,
      subtitle: isRouted ? ROUTED_HOSTED_DECISION_MODEL_SUBTITLE : preview.description,
    };
    if (preview.fills.includes(role)) return option;
    return { ...option, disabled: true, hint: previewHint(preview) };
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
    ...langwatchDecisionOptions({ role: "INSTANT_EVALS", isJudgeRouted }),
    ...ownDecisionOptions({ pickable, isOwnModelEnabled }),
  ];
}

/**
 * The organization's own decision models in the Judge picker: the Instant Evals list's own rows,
 * listed whatever the router flag, never pickable. A scenario judge makes chat calls, which a
 * decision model does not answer, so the server refuses one for Judge (ADR-182).
 */
function judgeOwnDecisionOptions(decisionOptions: ModelPickerOption[]): ModelPickerOption[] {
  return decisionOptions
    .filter((option) => isOwnDecisionModelId(option.value))
    .map((option) => ({ ...option, disabled: true, hint: onlyFillsHint(["INSTANT_EVALS"]) }));
}

/**
 * One column's picker: the options above the inherit entry, then the rest. Instant Evals lists
 * decision models only; Judge lists the decision models on top, unpickable, then the LLMs.
 */
export function rolePickerOptions({
  role,
  decisionOptions,
  llmOptions,
  isJudgeRouted,
}: {
  role: ModelRole;
  decisionOptions: ModelPickerOption[];
  llmOptions: ModelPickerOption[];
  isJudgeRouted: boolean;
}): { leading: ModelPickerOption[]; options: ModelPickerOption[] } {
  if (role === "INSTANT_EVALS") return { leading: [], options: decisionOptions };
  if (role === "JUDGE") {
    return {
      leading: [
        ...langwatchDecisionOptions({ role, isJudgeRouted }),
        ...judgeOwnDecisionOptions(decisionOptions),
      ],
      options: llmOptions,
    };
  }
  return { leading: [], options: llmOptions };
}
