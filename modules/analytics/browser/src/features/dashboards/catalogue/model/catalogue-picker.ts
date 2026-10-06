/**
 * The picker's contents from the catalogue: every widget that has code, grouped
 * by its branch of the question tree, each with the prompt Langy is drafted with.
 */

import {
  BLOCK_QUESTION_SECTIONS,
  type BlockQuestion,
  type BlockQuestionIcon,
  type BlockQuestionSection,
} from "../../model/block-questions.ts";
import type { BoardTemplateWidget } from "../../templates/index.ts";
import type { QuestionType, Trunk } from "./catalogue-labels.ts";
import { CATALOGUE_WIDGETS, type CatalogueWidget } from "./catalogue-widgets.ts";
import { QUESTION_TREE } from "./question-tree.ts";
import { implementedWidget, IMPLEMENTED_WIDGET_IDS } from "./widget-implementations.ts";

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

/** The hand-written prompts of the earlier picker, kept for the widgets they were written for. */
const EARLIER_QUESTION_IDS: Readonly<Record<string, string>> = {
  "ans-evaluators": "evaluations",
  "ck-status": "overall",
};
const earlierPrompts = new Map(
  BLOCK_QUESTION_SECTIONS.flatMap(({ questions }) => questions).map(({ id, prompt }) => [
    id,
    prompt,
  ]),
);

function promptFor(widget: CatalogueWidget): string {
  const earlier = earlierPrompts.get(EARLIER_QUESTION_IDS[widget.id] ?? widget.id);
  if (earlier !== void 0) return earlier;
  return (
    `Answer this question about my agent with LangWatchQL, over the dashboard period: ` +
    `"${widget.question}" ${widget.why} Quote the real numbers from the query result. ` +
    `If a query returns no rows, say plainly that there is no data for the dashboard period.`
  );
}

function pickerQuestion(widget: CatalogueWidget): BlockQuestion {
  return {
    id: widget.id,
    question: widget.question,
    why: widget.why,
    icon: ICONS[widget.questionType],
    prompt: promptFor(widget),
  };
}

const implemented = new Set(IMPLEMENTED_WIDGET_IDS);
const branches = [...new Map(QUESTION_TREE.map((q) => [q.branch, q.trunk] as const))];
const branchOf = new Map(QUESTION_TREE.map(({ id, branch }) => [id, branch] as const));

/** One section per branch of the question tree that has a widget with code, in tree order. */
export const PICKER_SECTIONS: readonly BlockQuestionSection[] = branches
  .map(([branch, trunk]) => ({
    id: branch.toLowerCase().replaceAll(/[^a-z]+/g, "-"),
    title: branch,
    why: `${trunk}: ${TRUNK_QUESTIONS[trunk]}`,
    summary: "",
    palette: TRUNK_PALETTES[trunk],
    questions: CATALOGUE_WIDGETS.filter(
      ({ id, questionId }) => implemented.has(id) && branchOf.get(questionId) === branch,
    ).map(pickerQuestion),
  }))
  .filter(({ questions }) => questions.length > 0);

/** The stored widget a picked catalogue widget adds. */
export function pickerWidgets(id: string): readonly BoardTemplateWidget[] {
  const widget = implementedWidget(id);
  if (!widget) throw new Error(`No code for catalogue widget "${id}"`);
  return [widget];
}
