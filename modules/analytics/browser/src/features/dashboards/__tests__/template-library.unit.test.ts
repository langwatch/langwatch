/**
 * The templates library's search, chips, counts, sections and address.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CHART_GRID_COLUMNS } from "../../../model/chart-grid.ts";
import { CATALOGUE_TEMPLATES, CATALOGUE_WIDGETS, TRUNKS } from "../catalogue/index.ts";
import {
  catalogueChipCounts,
  type CatalogueFilters,
  filterCatalogue,
  NO_CATALOGUE_FILTERS,
} from "../model/catalogue-filter.ts";
import {
  type LibraryTemplate,
  TEMPLATE_LIBRARY,
  TEMPLATE_PREVIEW_IDS,
  templateFiltersFromQuery,
  templateFiltersQuery,
  templatePreviewSrc,
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
  preview: { kind: "layout", widgets: [] },
});

const TEMPLATES = [
  entry({ id: "costs", trunk: "Profit", agentKinds: ["voice"], status: "coming-soon" }),
  entry({ id: "models", trunk: "Profit", status: "ready" }),
  entry({ id: "calls", trunk: "Growth", agentKinds: ["voice"], status: "ready" }),
  entry({ id: "fields", trunk: "Growth", agentKinds: ["extraction"], status: "coming-soon" }),
  entry({ id: "safety", trunk: "Protect", agentKinds: ["regulated"], status: "coming-soon" }),
];

const shownIds = (filters: Partial<CatalogueFilters>) =>
  filterCatalogue({ items: TEMPLATES, filters: { ...NO_CATALOGUE_FILTERS, ...filters } }).map(
    ({ board }) => board.id,
  );

describe("the templates library", () => {
  describe("given every catalogue template", () => {
    /** @scenario "AC101 Templates library: every template is listed by trunk, ready ones first" */
    it("lists each one once, in trunk order, ready ones first in each section", () => {
      const sections = templateSections({ templates: TEMPLATE_LIBRARY });

      const listed = sections.flatMap(({ items }) => items.map(({ board }) => board.id));
      expect(listed.toSorted()).toEqual(CATALOGUE_TEMPLATES.map(({ id }) => id).toSorted());
      expect(sections.map(({ key }) => key)).toEqual(
        TRUNKS.filter((trunk) => sections.some((section) => section.key === trunk)),
      );
      for (const { items } of sections) {
        const statuses = items.map(({ status }) => status);
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
      const shown = filterCatalogue({
        items: TEMPLATE_LIBRARY,
        filters: { ...NO_CATALOGUE_FILTERS, search },
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
      const counts = catalogueChipCounts({
        items: TEMPLATES,
        filters: { ...NO_CATALOGUE_FILTERS, trunks: ["Profit"], statuses: ["ready"] },
      });

      expect(counts.trunks).toEqual({
        all: 2,
        byValue: { Profit: 1, Growth: 1, Protect: 0, Trust: 0 },
      });
      expect(counts.statuses).toEqual({ all: 2, byValue: { ready: 1, "coming-soon": 1 } });
      expect(counts.agentKinds.all).toBe(1);
      expect(counts.agentKinds.byValue.voice).toBe(1);
    });
  });

  describe("given a view in the address", () => {
    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("writes the search and chips over the rest of the query, and reads them back", () => {
      const filters: CatalogueFilters = {
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
        ...NO_CATALOGUE_FILTERS,
        trunks: ["Profit"],
      });
    });
  });

  describe("given each template's preview", () => {
    const titles = new Map(CATALOGUE_WIDGETS.map(({ id, title }) => [id, title]));
    const catalogue = new Map(CATALOGUE_TEMPLATES.map((template) => [template.id, template]));

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("shows the captured image of a template that has one", () => {
      expect(TEMPLATE_PREVIEW_IDS.size).toBeGreaterThan(0);
      for (const { board, preview } of TEMPLATE_LIBRARY) {
        if (!TEMPLATE_PREVIEW_IDS.has(board.id)) continue;
        expect(preview, board.id).toEqual({ kind: "image", src: templatePreviewSrc(board.id) });
      }
    });

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("ships an image file for every template it calls captured", () => {
      const publicDir = "../../../../../../../apps/ui/public";
      for (const id of TEMPLATE_PREVIEW_IDS) {
        const file = new URL(`${publicDir}${templatePreviewSrc(id)}`, import.meta.url);
        expect(existsSync(file), id).toBe(true);
      }
    });

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("sketches every other template's widgets by title, inside the board's columns", () => {
      for (const { board, preview } of TEMPLATE_LIBRARY) {
        if (TEMPLATE_PREVIEW_IDS.has(board.id)) continue;
        expect(preview.kind, board.id).toBe("layout");
        if (preview.kind !== "layout") continue;
        const widgetIds = catalogue.get(board.id)?.widgets ?? [];
        expect(
          preview.widgets.map(({ title }) => title),
          board.id,
        ).toEqual(widgetIds.map((id) => titles.get(id)));
        for (const { key, layout } of preview.widgets) {
          expect(layout.gridColumn + layout.colSpan, key).toBeLessThanOrEqual(CHART_GRID_COLUMNS);
        }
      }
    });
  });
});
