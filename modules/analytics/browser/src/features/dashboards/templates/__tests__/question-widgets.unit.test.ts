/**
 * Every picker question maps to at least one template widget, and each mapped
 * widget is a real widget on that question's section template.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { BLOCK_QUESTION_SECTIONS } from "../../model/block-questions.ts";
import { QUESTION_TEMPLATES } from "../model/question-templates.ts";
import { questionWidgets } from "../model/question-widgets.ts";

const EVERY_QUESTION = BLOCK_QUESTION_SECTIONS.flatMap(({ questions }) => questions);

const TEMPLATE_WIDGET_KEYS = new Set(
  QUESTION_TEMPLATES.flatMap(({ widgets }) => widgets.map(({ key }) => key)),
);

describe("questionWidgets", () => {
  /** @scenario "AC12 A picked question adds its widget and seeds Langy" */
  it("maps every picker question to at least one widget", () => {
    expect(EVERY_QUESTION.length).toBeGreaterThan(0);
    for (const { id } of EVERY_QUESTION) {
      expect(questionWidgets(id).length, id).toBeGreaterThanOrEqual(1);
    }
  });

  /** @scenario "AC12 A picked question adds its widget and seeds Langy" */
  it("only ever maps to widgets a question template stores", () => {
    for (const { id } of EVERY_QUESTION) {
      for (const widget of questionWidgets(id)) {
        expect(TEMPLATE_WIDGET_KEYS, `${id}:${widget.key}`).toContain(widget.key);
      }
    }
  });

  it("throws for a question id it does not map", () => {
    expect(() => questionWidgets("not-a-question")).toThrow(/not-a-question/);
  });
});
