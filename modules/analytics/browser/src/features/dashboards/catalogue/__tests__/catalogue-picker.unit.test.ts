/**
 * The picker offers exactly the catalogue widgets that have code, each once, under
 * its branch of the question tree, and picking one stores it under its question.
 */

import { describe, expect, it } from "vitest";

import {
  CATALOGUE_WIDGETS,
  IMPLEMENTED_WIDGET_IDS,
  PICKER_SECTIONS,
  pickerWidgets,
  QUESTION_TREE,
} from "../index.ts";

const offered = PICKER_SECTIONS.flatMap(({ questions }) => questions);
const widgetById = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget] as const));

describe("given the catalogue picker", () => {
  /** @scenario "AC16 The picker offers every catalogue widget that has code, grouped by the question tree" */
  it("offers every widget with code exactly once, and nothing else", () => {
    expect(IMPLEMENTED_WIDGET_IDS.length).toBeGreaterThan(0);
    expect(offered.map(({ id }) => id).toSorted()).toEqual([...IMPLEMENTED_WIDGET_IDS].toSorted());
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, grouped by the question tree" */
  it("puts each widget under its branch of the question tree, with sections in tree order", () => {
    const branchOf = new Map(QUESTION_TREE.map(({ id, branch }) => [id, branch] as const));
    const treeOrder = [...new Set(QUESTION_TREE.map(({ branch }) => branch))];
    const titles = PICKER_SECTIONS.map(({ title }) => title);
    expect(titles).toEqual(treeOrder.filter((branch) => titles.includes(branch)));
    for (const section of PICKER_SECTIONS) {
      for (const { id, question, prompt } of section.questions) {
        const widget = widgetById.get(id);
        expect(branchOf.get(widget?.questionId ?? ""), id).toBe(section.title);
        expect(question, id).toBe(widget?.question);
        expect(prompt.length, id).toBeGreaterThan(0);
      }
    }
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, grouped by the question tree" */
  it("stores a picked widget under the question it answers", () => {
    for (const { id, question } of offered) {
      const [stored, ...rest] = pickerWidgets(id);
      expect(rest, id).toEqual([]);
      expect(stored?.name, id).toBe(question);
      expect(stored?.definition.code.length, id).toBeGreaterThan(0);
    }
    expect(() => pickerWidgets("not-a-widget")).toThrow(/not-a-widget/);
  });
});
