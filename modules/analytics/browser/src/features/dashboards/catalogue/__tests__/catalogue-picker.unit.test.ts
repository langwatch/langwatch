/**
 * The picker lists every catalogue widget once, under its branch of the question
 * tree. Widgets with code can be picked; the rest say "Coming soon".
 */

import { describe, expect, it } from "vitest";

import {
  CATALOGUE_WIDGETS,
  IMPLEMENTED_WIDGET_IDS,
  PICKER_SECTIONS,
  pickerWidgets,
  QUESTION_TREE,
} from "../index.ts";

const listed = PICKER_SECTIONS.flatMap(({ questions }) => questions);
const widgetById = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget] as const));
const built = new Set(IMPLEMENTED_WIDGET_IDS);

describe("given the catalogue picker", () => {
  /** @scenario "AC17 Every widget and template is listed, coming soon until it is built" */
  it("lists every catalogue widget exactly once", () => {
    expect(listed.map(({ id }) => id).toSorted()).toEqual(
      CATALOGUE_WIDGETS.map(({ id }) => id).toSorted(),
    );
  });

  /** @scenario "AC17 Every widget and template is listed, coming soon until it is built" */
  it("marks a widget coming soon exactly when it has no code", () => {
    expect(built.size).toBeGreaterThan(0);
    for (const { id, comingSoon } of listed) expect(comingSoon === true, id).toBe(!built.has(id));
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, grouped by the question tree" */
  it("puts each widget under its branch of the question tree, with sections in tree order", () => {
    const branchOf = new Map(QUESTION_TREE.map(({ id, branch }) => [id, branch] as const));
    const treeOrder = [...new Set(QUESTION_TREE.map(({ branch }) => branch))];
    expect(PICKER_SECTIONS.map(({ title }) => title)).toEqual(
      treeOrder.filter((branch) => PICKER_SECTIONS.some(({ title }) => title === branch)),
    );
    for (const section of PICKER_SECTIONS) {
      for (const { id, question } of section.questions) {
        const widget = widgetById.get(id);
        expect(branchOf.get(widget?.questionId ?? ""), id).toBe(section.title);
        expect(question, id).toBe(widget?.question);
      }
    }
  });

  /** @scenario "AC18 Every widget and template carries a default Langy prompt" */
  it("drafts every widget with a prompt that asks its question over the dashboard period", () => {
    for (const { id, question, prompt } of listed) {
      expect(prompt.startsWith(question), id).toBe(true);
      expect(prompt, id).toContain("dashboard period");
    }
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, grouped by the question tree" */
  it("stores a picked built widget under the question it answers", () => {
    for (const { id, question } of listed.filter(({ comingSoon }) => !comingSoon)) {
      const [stored, ...rest] = pickerWidgets(id);
      expect(rest, id).toEqual([]);
      expect(stored?.name, id).toBe(question);
    }
    expect(() => pickerWidgets("not-a-widget")).toThrow(/not-a-widget/);
  });
});
