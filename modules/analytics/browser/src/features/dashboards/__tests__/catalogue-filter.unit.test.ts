/**
 * The shared catalogue filter over "Add a widget": the category chip, its counts, the search
 * and the sections. The templates finder's side is in template-library.unit.test.ts.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_KIND_LABELS,
  PICKER_QUESTIONS,
  pickerSections,
  type PickerQuestion,
  QUESTION_BRANCHES,
  TRUNKS,
} from "../catalogue/index.ts";
import {
  type CatalogueFilters,
  filterCatalogue,
  NO_CATALOGUE_FILTERS,
  trunkCounts,
} from "../model/catalogue-filter.ts";

const shown = (filters: Partial<CatalogueFilters>) =>
  filterCatalogue({ items: PICKER_QUESTIONS, filters: { ...NO_CATALOGUE_FILTERS, ...filters } });

const ids = (questions: readonly PickerQuestion[]) => questions.map(({ id }) => id);

describe("the picker's catalogue filter", () => {
  describe("when the member picks a category", () => {
    /** @scenario "AC131 Picker filters: chips narrow the widgets by category and agent type" */
    it("shows only that category's widgets", () => {
      const result = shown({ trunk: "Protect" });

      expect(result.length).toBeGreaterThan(0);
      expect(ids(result)).toEqual(ids(PICKER_QUESTIONS.filter(({ trunk }) => trunk === "Protect")));
    });

    /** @scenario "AC131 Picker filters: chips narrow the widgets by category and agent type" */
    it("applies the search and the category together", () => {
      const result = shown({ trunk: "Protect", search: "latency" });

      expect(result.length).toBeGreaterThan(0);
      for (const question of result) {
        expect(question.trunk, question.id).toBe("Protect");
        expect(question.searchText, question.id).toContain("latency");
      }
    });

    /** @scenario "AC131 Picker filters: chips narrow the widgets by category and agent type" */
    it("shows every widget on All", () => {
      expect(shown({})).toHaveLength(PICKER_QUESTIONS.length);
    });
  });

  describe("given a search", () => {
    /** @scenario "AC132 Picker filters: each chip counts the widgets it would show" */
    it("counts each category with the search applied, and All as their sum", () => {
      const counts = trunkCounts({ items: PICKER_QUESTIONS, search: "latency" });
      const searched = shown({ search: "latency" });

      expect(counts.all).toBe(searched.length);
      expect(counts.all).toBeGreaterThan(0);
      expect(counts.all).toBeLessThan(PICKER_QUESTIONS.length);
      for (const trunk of TRUNKS) {
        expect(counts.byTrunk[trunk], trunk).toBe(
          searched.filter((question) => question.trunk === trunk).length,
        );
      }
    });
  });

  describe("when the member searches", () => {
    const target = PICKER_QUESTIONS.find(({ madeFor }) => madeFor.length > 0)!;
    const [kind] = target.madeFor;
    const promptOnly = target.prompt.split(". ")[1] ?? target.prompt;

    /** @scenario "AC133 Picker filters: search matches the question, line, prompt, branch and agent kinds" */
    it.each([
      ["the question", target.question],
      ["the line", target.why],
      ["the prompt", promptOnly],
      ["the branch", target.branch.title],
      ["an agent kind", AGENT_KIND_LABELS[kind!]],
    ])("matches %s, ignoring case", (_what, search) => {
      const result = shown({ search: search.toUpperCase() });

      expect(result.length).toBeGreaterThan(0);
      for (const { searchText } of result) expect(searchText).toContain(search.toLowerCase());
    });

    /** @scenario "AC133 Picker filters: search matches the question, line, prompt, branch and agent kinds" */
    it("finds a widget by the words of its own prompt", () => {
      expect(ids(shown({ search: promptOnly }))).toContain(target.id);
    });

    /** @scenario "AC133 Picker filters: search matches the question, line, prompt, branch and agent kinds" */
    it("leaves out widgets the search does not match", () => {
      expect(shown({ search: "zzz-no-such-widget" })).toEqual([]);
    });
  });

  describe("given the sections", () => {
    /** @scenario "AC134 Picker filters: sections are branches in tree order, coloured by trunk" */
    it("lists every widget once, under its branch, branches in tree order", () => {
      const sections = pickerSections({ questions: PICKER_QUESTIONS });
      const treeOrder: readonly string[] = QUESTION_BRANCHES.map(({ title }) => title);

      expect(sections.flatMap(({ questions }) => ids(questions))).toEqual(
        expect.arrayContaining(ids(PICKER_QUESTIONS)),
      );
      expect(sections.flatMap(({ questions }) => questions)).toHaveLength(PICKER_QUESTIONS.length);
      const order = sections.map(({ title }) => treeOrder.indexOf(title));
      expect(order).toEqual(order.toSorted((a, b) => a - b));
      const trunks = sections.map(({ trunk }) => TRUNKS.indexOf(trunk));
      expect(trunks).toEqual(trunks.toSorted((a, b) => a - b));
      expect(sections[0]?.trunk).toBe(TRUNKS[0]);
      for (const section of sections) {
        for (const question of section.questions) {
          expect(question.branch.title, question.id).toBe(section.title);
          expect(question.trunk, question.id).toBe(section.trunk);
        }
      }
    });

    /** @scenario "AC134 Picker filters: sections are branches in tree order, coloured by trunk" */
    it("drops a branch the category leaves empty", () => {
      const sections = pickerSections({ questions: shown({ trunk: "Protect" }) });

      expect(sections.length).toBeGreaterThan(0);
      expect(sections.every(({ trunk }) => trunk === "Protect")).toBe(true);
    });
  });
});
