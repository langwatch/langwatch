/**
 * "Add a widget" lists every built widget once, under its branch of the question tree.
 * Widgets without code and coding-agent widgets are left out.
 */

import { describe, expect, it } from "vitest";

import {
  CATALOGUE_WIDGETS,
  IMPLEMENTED_WIDGET_IDS,
  PICKER_QUESTIONS,
  PICKER_SECTIONS,
  pickerPool,
  pickerWidgets,
  QUESTION_BRANCHES,
  QUESTION_TREE,
} from "../index.ts";

const listed = PICKER_SECTIONS.flatMap(({ questions }) => questions);
const listedIds = new Set(listed.map(({ id }) => id));
const widgetById = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget] as const));
const built = new Set(IMPLEMENTED_WIDGET_IDS);
const isCoding = (id: string) => {
  const widget = widgetById.get(id)!;
  return (
    widget.agentKinds.includes("coding") ||
    widget.requirements.some((keys) => keys.includes("coding"))
  );
};

describe("given the catalogue picker", () => {
  /** @scenario "AC17 Only what is built is offered" */
  it("lists every built widget once, and none without code", () => {
    expect(listed.length).toBe(listedIds.size);
    for (const { id } of CATALOGUE_WIDGETS) {
      expect(listedIds.has(id), id).toBe(built.has(id) && !isCoding(id));
    }
  });

  /** @scenario "Finder: Add a widget leaves out coding-agent widgets" */
  it("leaves out every widget made for coding agents or reading their traces", () => {
    const coding = CATALOGUE_WIDGETS.filter(({ id }) => built.has(id) && isCoding(id));
    expect(coding.length).toBeGreaterThan(0);
    for (const { id } of coding) expect(listedIds.has(id), id).toBe(false);
  });

  /** @scenario "AC16 The picker offers every catalogue widget that has code, grouped by the question tree" */
  it("puts each widget under its question's branch, with sections in tree order", () => {
    const branchOf = new Map(QUESTION_TREE.map(({ id, branch }) => [id, branch] as const));
    const treeOrder = QUESTION_BRANCHES.map(({ title }) => title);
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
  it("stores a picked widget under the question it answers", () => {
    for (const { id, question } of listed) {
      const [stored, ...rest] = pickerWidgets(id);
      expect(rest, id).toEqual([]);
      expect(stored?.name, id).toBe(question);
    }
    expect(() => pickerWidgets("not-a-widget")).toThrow(/not-a-widget/);
  });

  /** @scenario "AC138 Picker filters: a row names the agent types its widget is made for" */
  it("names up to three agent kinds a widget is made for, and none for a general one", () => {
    for (const { id, madeFor } of PICKER_QUESTIONS) {
      const kinds = widgetById.get(id)!.agentKinds;
      expect(madeFor, id).toEqual(kinds.length <= 3 ? kinds : []);
    }
    expect(PICKER_QUESTIONS.some(({ madeFor }) => madeFor.length > 0)).toBe(true);
  });

  /** @scenario "AC131 Picker filters: chips narrow the widgets by category and agent type" */
  it("offers only the widgets made for a picked agent type", () => {
    expect(pickerPool({})).toBe(PICKER_QUESTIONS);
    const voice = pickerPool({ agentKind: "voice" });
    expect(voice.length).toBeGreaterThan(0);
    expect(voice.every(({ madeFor }) => madeFor.includes("voice"))).toBe(true);
    expect(voice.length).toBe(
      PICKER_QUESTIONS.filter(({ madeFor }) => madeFor.includes("voice")).length,
    );
  });
});
