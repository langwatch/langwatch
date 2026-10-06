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
import { BOARD_LWQL_VIEWS } from "../../model/board-lwql-views.ts";
import type { BoardTemplateWidget } from "../../templates/model/board-template.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";
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

/** The LangWatchQL views a built widget's queries read, so its prompt can name them. */
function viewsOf(id: string): string[] {
  const queries = Object.values(CATALOGUE_WIDGET_BUILDS[id]?.queries ?? {});
  const named = queries.flatMap((sql) => [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)]);
  const views = new Set(named.map((match) => match[1]));
  return BOARD_LWQL_VIEWS.filter((view) => views.has(view));
}

/** The widget's own prompt, naming the views its queries read when it does not yet. */
function promptFor(widget: CatalogueWidget): string {
  const views = viewsOf(widget.id);
  if (views.length === 0 || views.some((view) => widget.prompt.includes(view))) {
    return widget.prompt;
  }
  return `${widget.prompt} Read it from the LangWatchQL views ${views.join(", ")}.`;
}

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
