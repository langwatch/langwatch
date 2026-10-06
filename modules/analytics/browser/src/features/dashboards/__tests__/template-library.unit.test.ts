/**
 * The templates library's search, chips, counts, sections and address.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { describe, expect, it } from "vitest";

import { CATALOGUE_TEMPLATES, TRUNKS } from "../catalogue/index.ts";
import {
  filterTemplates,
  type LibraryTemplate,
  NO_TEMPLATE_FILTERS,
  TEMPLATE_LIBRARY,
  templateChipCounts,
  templateFiltersFromQuery,
  templateFiltersQuery,
  type TemplateLibraryFilters,
  templateSections,
} from "../model/template-library.ts";

const entry = ({
  id,
  trunk = "Growth",
  agentKinds = [],
  status = "ready",
  searchText = id,
}: Partial<Omit<LibraryTemplate, "board">> & { id: string }): LibraryTemplate => ({
  board: { id, name: id, description: "", widgets: [] },
  trunk,
  agentKinds,
  widgetCount: 1,
  status,
  searchText,
});

const TEMPLATES = [
  entry({ id: "costs", trunk: "Profit", agentKinds: ["voice"], status: "coming-soon" }),
  entry({ id: "models", trunk: "Profit", status: "ready" }),
  entry({ id: "calls", trunk: "Growth", agentKinds: ["voice"], status: "ready" }),
  entry({ id: "fields", trunk: "Growth", agentKinds: ["extraction"], status: "coming-soon" }),
  entry({ id: "safety", trunk: "Protect", agentKinds: ["regulated"], status: "coming-soon" }),
];

const shownIds = (filters: Partial<TemplateLibraryFilters>) =>
  filterTemplates({ templates: TEMPLATES, filters: { ...NO_TEMPLATE_FILTERS, ...filters } }).map(
    ({ board }) => board.id,
  );

describe("the templates library", () => {
  describe("given every catalogue template", () => {
    /** @scenario "AC101 Templates library: every template is listed by trunk, ready ones first" */
    it("lists each one once, in trunk order, ready ones first in each section", () => {
      const sections = templateSections({ templates: TEMPLATE_LIBRARY });

      const listed = sections.flatMap(({ templates }) => templates.map(({ board }) => board.id));
      expect(listed.toSorted()).toEqual(CATALOGUE_TEMPLATES.map(({ id }) => id).toSorted());
      expect(sections.map(({ trunk }) => trunk)).toEqual(
        TRUNKS.filter((trunk) => sections.some((section) => section.trunk === trunk)),
      );
      for (const { templates } of sections) {
        const statuses = templates.map(({ status }) => status);
        const firstSoon = statuses.indexOf("coming-soon");
        expect(statuses.slice(firstSoon === -1 ? statuses.length : firstSoon)).not.toContain(
          "ready",
        );
      }
    });
  });

  describe("when the member searches", () => {
    /** @scenario "AC102 Templates library: search matches name, job, widget questions and agent kinds" */
    it.each([
      ["a name", "running costs", "costs"],
      ["a job", "where the money goes", "costs"],
      ["a widget question", "which model costs me the most", "costs"],
      ["an agent kind", "VOICE AGENT", "calls"],
    ])("matches %s, ignoring case", (_what, search, id) => {
      const shown = filterTemplates({
        templates: TEMPLATE_LIBRARY,
        filters: { ...NO_TEMPLATE_FILTERS, search },
      });

      expect(shown.map(({ board }) => board.id)).toContain(id);
    });

    /** @scenario "AC102 Templates library: search matches name, job, widget questions and agent kinds" */
    it("leaves out templates the search does not match", () => {
      expect(shownIds({ search: "zzz-no-such-template" })).toEqual([]);
    });
  });

  describe("when the member picks chips", () => {
    /** @scenario "AC103 Templates library: filter chips narrow by trunk, agent kind and readiness" */
    it("shows templates matching any chip in one group", () => {
      expect(shownIds({ trunks: ["Profit", "Protect"] })).toEqual(["costs", "models", "safety"]);
    });

    /** @scenario "AC103 Templates library: filter chips narrow by trunk, agent kind and readiness" */
    it("applies chips in different groups together", () => {
      expect(shownIds({ trunks: ["Profit"], statuses: ["ready"] })).toEqual(["models"]);
    });

    /** @scenario "AC103 Templates library: filter chips narrow by trunk, agent kind and readiness" */
    it("keeps a template that names no agent kind under every agent kind", () => {
      expect(shownIds({ agentKinds: ["voice"] })).toEqual(["costs", "models", "calls"]);
    });

    /** @scenario "AC103 Templates library: filter chips narrow by trunk, agent kind and readiness" */
    it("counts each chip with the search and the other groups applied, never its own", () => {
      const counts = templateChipCounts({
        templates: TEMPLATES,
        filters: { ...NO_TEMPLATE_FILTERS, trunks: ["Profit"], statuses: ["ready"] },
      });

      expect(counts.trunks).toEqual({
        all: 2,
        byValue: { Profit: 1, Growth: 1, Protect: 0, Foundation: 0 },
      });
      expect(counts.statuses).toEqual({ all: 2, byValue: { ready: 1, "coming-soon": 1 } });
      expect(counts.agentKinds.all).toBe(1);
      expect(counts.agentKinds.byValue.voice).toBe(1);
    });
  });

  describe("given a view in the address", () => {
    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("writes the search and chips over the rest of the query, and reads them back", () => {
      const filters: TemplateLibraryFilters = {
        search: "cost",
        trunks: ["Profit", "Growth"],
        agentKinds: ["voice"],
        statuses: [],
      };

      const query = templateFiltersQuery({ query: { other: "kept" }, filters });

      expect(query).toEqual({
        other: "kept",
        q: "cost",
        trunk: "Profit,Growth",
        agent: "voice",
        status: undefined,
      });
      expect(templateFiltersFromQuery(query)).toEqual(filters);
    });

    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("drops chip values it does not know", () => {
      expect(templateFiltersFromQuery({ trunk: "Profit,Nope", status: "later" })).toEqual({
        ...NO_TEMPLATE_FILTERS,
        trunks: ["Profit"],
      });
    });
  });
});
