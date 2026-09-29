/**
 * Which template widgets answer each picker question. The widgets are reused
 * from the question templates, resolved within the question's own section
 * template so a key shared across sections (error-types) stays unambiguous. Pure.
 */

import { BLOCK_QUESTION_SECTIONS } from "../../model/block-questions.ts";
import type { BoardTemplate, BoardTemplateWidget } from "./board-template.ts";
import { QUESTION_TEMPLATES } from "./question-templates.ts";

/**
 * The template widget keys answering each question, within its section template.
 * The thirteen single-widget questions name the key equal to their id; the three
 * "how to" questions name the widgets their walkthrough starts from.
 */
const WIDGET_KEYS_BY_QUESTION: Readonly<Record<string, readonly string[]>> = {
  overall: ["overall"],
  traffic: ["traffic"],
  "satisfaction-shift": ["satisfaction-shift"],
  "token-drift": ["token-drift"],
  "conversation-length": ["conversation-length"],
  "latency-slo": ["latency-slo"],
  "error-rate": ["error-rate"],
  "latency-spread": ["latency-spread"],
  spend: ["spend"],
  "top-models": ["top-models"],
  evaluations: ["evaluations"],
  scenarios: ["scenarios"],
  topics: ["topics"],
  "howto-latency": ["slowest-operations", "slowest-models"],
  "howto-responses": ["error-types", "thumbs-down", "lowest-scores"],
  "howto-evals": ["evaluation-coverage"],
};

const sectionIdByQuestionId: ReadonlyMap<string, string> = new Map(
  BLOCK_QUESTION_SECTIONS.flatMap((section) =>
    section.questions.map((question) => [question.id, section.id] as const),
  ),
);

const templateById: ReadonlyMap<string, BoardTemplate> = new Map(
  QUESTION_TEMPLATES.map((template) => [template.id, template] as const),
);

/** The stored widgets a picked question adds, in the order they are placed. */
export function questionWidgets(questionId: string): readonly BoardTemplateWidget[] {
  const sectionId = sectionIdByQuestionId.get(questionId);
  const template = sectionId === void 0 ? void 0 : templateById.get(sectionId);
  const keys = WIDGET_KEYS_BY_QUESTION[questionId] ?? [];
  if (!template || keys.length === 0) {
    throw new Error(`No widgets mapped for picker question "${questionId}"`);
  }
  return keys.map((key) => {
    const widget = template.widgets.find((candidate) => candidate.key === key);
    if (!widget) {
      throw new Error(`Question "${questionId}" maps to unknown widget "${key}"`);
    }
    return widget;
  });
}
