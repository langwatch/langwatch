/**
 * The picker's contents from the catalogue: every widget, grouped by its branch of the
 * question tree, each with the prompt Langy is drafted with. Widgets without code say
 * "Coming soon" and cannot be picked yet.
 */

import {
  type BlockQuestion,
  type BlockQuestionIcon,
  type BlockQuestionSection,
} from "../../model/block-questions.ts";
import type { BoardTemplateWidget } from "../../templates/model/board-template.ts";
import type { QuestionType, Trunk } from "./catalogue-labels.ts";
import { CATALOGUE_WIDGETS, type CatalogueWidget } from "./catalogue-widgets.ts";
import { QUESTION_TREE } from "./question-tree.ts";
import { implementedWidget, IMPLEMENTED_WIDGET_IDS, promptFor } from "./widget-implementations.ts";

const TRUNK_PALETTES: Readonly<Record<Trunk, string>> = {
  Profit: "yellow",
  Growth: "teal",
  Protect: "pink",
  Foundation: "purple",
};

const TRUNK_QUESTIONS: Readonly<Record<Trunk, string>> = {
  Profit: "Am I spending well?",
  Growth: "Is it growing my business?",
  Protect: "Can it hurt me?",
  Foundation: "Can I trust the numbers?",
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

function pickerQuestion(widget: CatalogueWidget): BlockQuestion {
  return {
    id: widget.id,
    question: widget.question,
    why: widget.why,
    icon: ICONS[widget.questionType],
    prompt: promptFor(widget),
    ...(implemented.has(widget.id) ? {} : { comingSoon: true }),
  };
}

const implemented = new Set(IMPLEMENTED_WIDGET_IDS);
const branches = [...new Map(QUESTION_TREE.map((q) => [q.branch, q.trunk] as const))];
const branchOf = new Map(QUESTION_TREE.map(({ id, branch }) => [id, branch] as const));

/** One section per branch of the question tree, in tree order. */
export const PICKER_SECTIONS: readonly BlockQuestionSection[] = branches
  .map(([branch, trunk]) => ({
    id: branch.toLowerCase().replaceAll(/[^a-z]+/g, "-"),
    title: branch,
    why: `${trunk}: ${TRUNK_QUESTIONS[trunk]}`,
    summary: "",
    palette: TRUNK_PALETTES[trunk],
    questions: CATALOGUE_WIDGETS.filter(
      ({ questionId }) => branchOf.get(questionId) === branch,
    ).map(pickerQuestion),
  }))
  .filter(({ questions }) => questions.length > 0);

/** The stored widget a picked catalogue widget adds. */
export function pickerWidgets(id: string): readonly BoardTemplateWidget[] {
  const widget = implementedWidget(id);
  if (!widget) throw new Error(`No code for catalogue widget "${id}"`);
  return [widget];
}
