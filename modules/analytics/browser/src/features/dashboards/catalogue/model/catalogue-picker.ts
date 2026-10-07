/**
 * The "Add a widget" picker's contents from the catalogue: every widget that has code, with
 * the prompt Langy is drafted with, what the shared catalogue filter narrows it by, and its
 * branch of the question tree. Coding-agent widgets are left out.
 */

import {
  type CatalogueItem,
  catalogueSearchText,
  catalogueSections,
} from "../../model/catalogue-filter.ts";
import type { WidgetQuestion, WidgetQuestionIcon } from "../../model/widget-questions.ts";
import type { BoardTemplateWidget } from "../../templates/model/board-template.ts";
import type { AgentKind, QuestionType, Trunk } from "./catalogue-labels.ts";
import { CATALOGUE_WIDGETS, type CatalogueWidget } from "./catalogue-widgets.ts";
import { QUESTION_BRANCHES, QUESTION_TREE } from "./question-tree.ts";
import { implementedWidget, IMPLEMENTED_WIDGET_IDS, promptFor } from "./widget-implementations.ts";

const ICONS: Readonly<Record<QuestionType, WidgetQuestionIcon>> = {
  happened: "activity",
  changed: "trendingDown",
  line: "alertTriangle",
  compare: "gitCompare",
  why: "helpCircle",
  matters: "gauge",
  prove: "scale",
};

/** A branch of the question tree, as its picker section heads it. */
export interface PickerBranch {
  readonly id: string;
  readonly title: string;
  readonly trunk: Trunk;
  /** What the branch covers, beside its title. */
  readonly why: string;
}

/** A picker row: what adding it needs, what the chips and search read, and its branch. */
export interface PickerQuestion extends WidgetQuestion, CatalogueItem {
  readonly branch: PickerBranch;
  /** The agent kinds the widget is made for; empty for a general widget. */
  readonly madeFor: readonly AgentKind[];
}

/** One branch's rows. */
export interface PickerSection extends PickerBranch {
  readonly questions: readonly PickerQuestion[];
}

/** Every branch of the tree, in tree order. */
const PICKER_BRANCHES: readonly PickerBranch[] = QUESTION_BRANCHES.map((branch) => ({
  ...branch,
  id: branch.title.toLowerCase().replaceAll(/[^a-z]+/g, "-"),
}));

/** A widget naming more agent kinds than this suits most kinds, not one of them. */
const MADE_FOR_MAX = 3;

const implemented = new Set(IMPLEMENTED_WIDGET_IDS);
const branchByTitle = new Map(PICKER_BRANCHES.map((branch) => [branch.title, branch] as const));
const branchOf = new Map(
  QUESTION_TREE.map(({ id, branch }) => [id, branchByTitle.get(branch)] as const),
);

/** Made for coding agents, or reads their traces: those widgets live with coding agents. */
const isCodingWidget = (widget: CatalogueWidget): boolean =>
  widget.agentKinds.includes("coding") ||
  widget.requirements.some((keys) => keys.includes("coding"));

function pickerQuestion({
  widget,
  branch,
}: {
  widget: CatalogueWidget;
  branch: PickerBranch;
}): PickerQuestion {
  const prompt = promptFor(widget);
  return {
    id: widget.id,
    question: widget.question,
    why: widget.why,
    icon: ICONS[widget.questionType],
    prompt,
    branch,
    trunk: branch.trunk,
    madeFor: widget.agentKinds.length <= MADE_FOR_MAX ? widget.agentKinds : [],
    searchText: catalogueSearchText({
      words: [widget.question, widget.why, prompt, branch.title],
      agentKinds: widget.agentKinds,
    }),
  };
}

/** Every built widget on the tree, in catalogue order, coding-agent widgets left out. */
export const PICKER_QUESTIONS: readonly PickerQuestion[] = CATALOGUE_WIDGETS.flatMap((widget) => {
  const branch = branchOf.get(widget.questionId);
  if (!branch || !implemented.has(widget.id) || isCodingWidget(widget)) return [];
  return [pickerQuestion({ widget, branch })];
});

/** The widgets a picker view offers: every one, or only those made for the picked agent type. */
export function pickerPool({ agentKind }: { agentKind?: AgentKind }): readonly PickerQuestion[] {
  if (!agentKind) return PICKER_QUESTIONS;
  return PICKER_QUESTIONS.filter(({ madeFor }) => madeFor.includes(agentKind));
}

/** One section per branch, in tree order; empty branches left out. */
export function pickerSections({
  questions,
}: {
  questions: readonly PickerQuestion[];
}): PickerSection[] {
  return catalogueSections({
    items: questions,
    keys: PICKER_BRANCHES,
    keyOf: ({ branch }) => branch,
  }).map(({ key, items }) => ({ ...key, questions: items }));
}

/** Every picker question in its section, before any search or chip narrows it. */
export const PICKER_SECTIONS: readonly PickerSection[] = pickerSections({
  questions: PICKER_QUESTIONS,
});

/** The stored widget a picked catalogue widget adds. */
export function pickerWidgets(id: string): readonly BoardTemplateWidget[] {
  const widget = implementedWidget(id);
  if (!widget) throw new Error(`No code for catalogue widget "${id}"`);
  return [widget];
}
