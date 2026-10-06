/**
 * The shared catalogue filter over the "Add a block" picker's widgets: chips, counts, search
 * and sections. The templates library's side is in template-library.unit.test.ts.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import {
  AGENT_KIND_LABELS,
  PICKER_QUESTIONS,
  pickerSections,
  type PickerQuestion,
  TRUNKS,
} from "../catalogue/index.ts";
import {
  catalogueChipCounts,
  type CatalogueFilters,
  filterCatalogue,
  NO_CATALOGUE_FILTERS,
} from "../model/catalogue-filter.ts";

const shown = (filters: Partial<CatalogueFilters>) =>
  filterCatalogue({ items: PICKER_QUESTIONS, filters: { ...NO_CATALOGUE_FILTERS, ...filters } });

const ids = (questions: readonly PickerQuestion[]) => questions.map(({ id }) => id);

const ANY_AGENT = PICKER_QUESTIONS.filter(({ agentKinds }) => agentKinds.length === 0);

describe("the picker's catalogue filter", () => {
  describe("when the member picks chips", () => {
    /** @scenario "AC131 Picker filters: chips narrow the widgets by trunk, agent kind and readiness" */
    it("shows widgets matching any chip in one group", () => {
      const result = shown({ trunks: ["Profit", "Protect"] });

      expect(result.length).toBeGreaterThan(0);
      expect(ids(result)).toEqual(
        ids(PICKER_QUESTIONS.filter(({ trunk }) => trunk === "Profit" || trunk === "Protect")),
      );
    });

    /** @scenario "AC131 Picker filters: chips narrow the widgets by trunk, agent kind and readiness" */
    it("applies chips in different groups together", () => {
      const result = shown({ trunks: ["Growth"], statuses: ["ready"] });

      expect(result.length).toBeGreaterThan(0);
      expect(ids(result)).toEqual(
        ids(
          PICKER_QUESTIONS.filter(({ trunk, status }) => trunk === "Growth" && status === "ready"),
        ),
      );
    });

    /** @scenario "AC131 Picker filters: chips narrow the widgets by trunk, agent kind and readiness" */
    it("keeps a widget that names no agent kind under every agent kind", () => {
      const result = ids(shown({ agentKinds: ["voice"] }));

      expect(ANY_AGENT.length).toBeGreaterThan(0);
      for (const { id } of ANY_AGENT) expect(result, id).toContain(id);
      for (const question of shown({ agentKinds: ["voice"] })) {
        const suits = question.agentKinds.length === 0 || question.agentKinds.includes("voice");
        expect(suits, question.id).toBe(true);
      }
    });

    /** @scenario "AC131 Picker filters: chips narrow the widgets by trunk, agent kind and readiness" */
    it("shows every widget when every group is on All", () => {
      expect(shown({})).toHaveLength(PICKER_QUESTIONS.length);
    });
  });

  describe("given a chip picked", () => {
    /** @scenario "AC132 Picker filters: each chip counts the widgets it would show" */
    it("counts each chip with the other groups applied, never its own", () => {
      const filters = { ...NO_CATALOGUE_FILTERS, trunks: ["Profit" as const] };
      const counts = catalogueChipCounts({ items: PICKER_QUESTIONS, filters });
      const profit = PICKER_QUESTIONS.filter(({ trunk }) => trunk === "Profit");

      expect(counts.trunks.all).toBe(PICKER_QUESTIONS.length);
      for (const trunk of TRUNKS) {
        expect(counts.trunks.byValue[trunk], trunk).toBe(
          PICKER_QUESTIONS.filter((question) => question.trunk === trunk).length,
        );
      }
      expect(counts.statuses.all).toBe(profit.length);
      expect(counts.statuses.byValue.ready).toBe(
        profit.filter(({ status }) => status === "ready").length,
      );
    });

    /** @scenario "AC132 Picker filters: each chip counts the widgets it would show" */
    it("narrows the counts as the member searches", () => {
      const all = catalogueChipCounts({ items: PICKER_QUESTIONS, filters: NO_CATALOGUE_FILTERS });
      const searched = catalogueChipCounts({
        items: PICKER_QUESTIONS,
        filters: { ...NO_CATALOGUE_FILTERS, search: "latency" },
      });

      expect(searched.trunks.all).toBe(shown({ search: "latency" }).length);
      expect(searched.trunks.all).toBeGreaterThan(0);
      expect(searched.trunks.all).toBeLessThan(all.trunks.all);
    });
  });

  describe("when the member searches", () => {
    const [kind] = PICKER_QUESTIONS.flatMap(({ agentKinds }) => agentKinds);
    const target = PICKER_QUESTIONS.find(({ agentKinds }) => agentKinds.length > 0)!;
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
    /** @scenario "AC134 Picker filters: sections are branches in trunk order, coloured by trunk" */
    it("lists every widget once, under its branch, branches in trunk order, built ones first", () => {
      const sections = pickerSections({ questions: PICKER_QUESTIONS });

      expect(sections.flatMap(({ questions }) => ids(questions)).toSorted()).toEqual(
        ids(PICKER_QUESTIONS).toSorted(),
      );
      const trunkOrder = sections.map(({ trunk }) => TRUNKS.indexOf(trunk));
      expect(trunkOrder).toEqual(trunkOrder.toSorted((a, b) => a - b));
      for (const section of sections) {
        for (const question of section.questions) {
          expect(question.branch.title, question.id).toBe(section.title);
          expect(question.trunk, question.id).toBe(section.trunk);
        }
        const statuses = section.questions.map(({ status }) => status);
        const firstSoon = statuses.indexOf("coming-soon");
        expect(statuses.slice(firstSoon === -1 ? statuses.length : firstSoon)).not.toContain(
          "ready",
        );
      }
    });

    /** @scenario "AC134 Picker filters: sections are branches in trunk order, coloured by trunk" */
    it("drops a branch the chips leave empty", () => {
      const sections = pickerSections({ questions: shown({ trunks: ["Protect"] }) });

      expect(sections.length).toBeGreaterThan(0);
      expect(sections.every(({ trunk }) => trunk === "Protect")).toBe(true);
    });
  });
});
