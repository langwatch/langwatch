/**
 * The catalogue's own words never lean on a bare "it": every question, title, category and
 * template names what it asks about, such as "Can my agent hurt me?".
 * @see modules/dashboard/specs/dashboards-finder.feature
 */

import { describe, expect, it } from "vitest";

import { SUGGESTED_QUESTIONS } from "../../langy/model/board-langy.ts";
import {
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  QUESTION_BRANCHES,
  QUESTION_TREE,
  QUESTION_TYPE_LABELS,
  TRUNK_QUESTIONS,
} from "../index.ts";

const BARE_IT = /\bit\b/i;

describe("the catalogue's copy", () => {
  /** @scenario "Copy: no question, title or category says a bare it" */
  it("names the subject instead of saying it", () => {
    const texts = [
      ...Object.values(TRUNK_QUESTIONS),
      ...Object.values(QUESTION_TYPE_LABELS),
      ...SUGGESTED_QUESTIONS,
      ...QUESTION_BRANCHES.flatMap(({ title, why }) => [title, why]),
      ...QUESTION_TREE.flatMap(({ question, short }) => [question, short]),
      ...CATALOGUE_WIDGETS.flatMap(({ question, title }) => [question, title]),
      ...CATALOGUE_TEMPLATES.flatMap(({ name, job }) => [name, job]),
    ];

    expect(texts.filter((text) => BARE_IT.test(text))).toEqual([]);
    expect(TRUNK_QUESTIONS.Protect).toBe("Can my agent hurt me?");
  });
});
