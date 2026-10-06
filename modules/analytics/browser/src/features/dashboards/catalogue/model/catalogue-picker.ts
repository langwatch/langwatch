/**
 * The picker's contents from the catalogue: every widget with the prompt Langy is drafted
 * with, what the shared catalogue filter narrows it by, and its branch of the question tree.
 * Widgets without code say "Coming soon" and cannot be picked yet.
 */

import { type BlockQuestion, type BlockQuestionIcon } from "../../model/block-questions.ts";
import {
  type CatalogueItem,
  catalogueSearchText,
  catalogueSections,
} from "../../model/catalogue-filter.ts";
import type { BoardTemplateWidget } from "../../templates/model/board-template.ts";
import { type QuestionType, type Trunk, TRUNKS } from "./catalogue-labels.ts";
import { CATALOGUE_WIDGETS, type CatalogueWidget } from "./catalogue-widgets.ts";
import { QUESTION_TREE } from "./question-tree.ts";
import { implementedWidget, IMPLEMENTED_WIDGET_IDS, promptFor } from "./widget-implementations.ts";

const TRUNK_QUESTIONS: Readonly<Record<Trunk, string>> = {
  Profit: "Am I spending well?",
  Growth: "Is it growing my business?",
  Protect: "Can it hurt me?",
  Trust: "Can I trust the numbers?",
};

const ICONS: Readonly<Record<QuestionType, BlockQuestionIcon>> = {
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
  /** The trunk and the question it answers, under the branch title. */
  readonly why: string;
}

/** A picker row: what adding it needs, what the chips and search read, and its branch. */
export interface PickerQuestion extends BlockQuestion, CatalogueItem {
  readonly branch: PickerBranch;
}

/** One branch's rows. */
export interface PickerSection extends PickerBranch {
  readonly questions: readonly PickerQuestion[];
}

/** Every branch of the tree, in trunk order, then tree order within a trunk. */
const PICKER_BRANCHES: readonly PickerBranch[] = [
  ...new Map(QUESTION_TREE.map(({ branch, trunk }) => [branch, trunk] as const)),
]
  .map(([branch, trunk]) => ({
    id: branch.toLowerCase().replaceAll(/[^a-z]+/g, "-"),
    title: branch,
    trunk,
    why: `${trunk}: ${TRUNK_QUESTIONS[trunk]}`,
  }))
  .toSorted((a, b) => TRUNKS.indexOf(a.trunk) - TRUNKS.indexOf(b.trunk));

const implemented = new Set(IMPLEMENTED_WIDGET_IDS);
const branchByTitle = new Map(PICKER_BRANCHES.map((branch) => [branch.title, branch] as const));
const branchOf = new Map(
  QUESTION_TREE.map(({ id, branch }) => [id, branchByTitle.get(branch)] as const),
);

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
    agentKinds: widget.agentKinds,
    status: implemented.has(widget.id) ? "ready" : "coming-soon",
    searchText: catalogueSearchText({
      words: [widget.question, widget.why, prompt, branch.title],
      agentKinds: widget.agentKinds,
    }),
  };
}

/** Every catalogue widget whose question sits on the tree, in catalogue order. */
export const PICKER_QUESTIONS: readonly PickerQuestion[] = CATALOGUE_WIDGETS.flatMap((widget) => {
  const branch = branchOf.get(widget.questionId);
  return branch ? [pickerQuestion({ widget, branch })] : [];
});

/** One section per branch, in trunk order, built widgets first; empty branches left out. */
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
