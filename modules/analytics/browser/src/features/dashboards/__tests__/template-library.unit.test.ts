/**
 * The templates finder's pool, search, category chip, counts, sections and address.
 * @see modules/dashboard/specs/dashboards-finder.feature
 */

import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CHART_GRID_COLUMNS } from "../../../model/chart-grid.ts";
import {
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  focusTemplateId,
  TRUNKS,
} from "../catalogue/index.ts";
import {
  type CatalogueFilters,
  filterCatalogue,
  NO_CATALOGUE_FILTERS,
  trunkCounts,
} from "../model/catalogue-filter.ts";
import {
  finderPool,
  type LibraryTemplate,
  TEMPLATE_LIBRARY,
  TEMPLATE_PREVIEW_IDS,
  templateFiltersFromQuery,
  templateFiltersQuery,
  templatePreviewSrc,
  templateSections,
} from "../model/template-library.ts";

const catalogue = new Map(CATALOGUE_TEMPLATES.map((template) => [template.id, template]));
const POOL = finderPool({});
const poolIds = (templates: readonly LibraryTemplate[]) => templates.map(({ board }) => board.id);

const shownIds = (filters: Partial<CatalogueFilters>) =>
  poolIds(filterCatalogue({ items: POOL, filters: { ...NO_CATALOGUE_FILTERS, ...filters } }));

describe("the templates finder", () => {
  describe("given no agent type picked", () => {
    /** @scenario "AC101 Templates library: every ready template is listed by trunk" */
    it("lists every ready template once, in trunk order, each base before its focus templates", () => {
      const sections = templateSections({ templates: POOL });
      const listed = sections.flatMap(({ items }) => poolIds(items));

      expect(listed.toSorted()).toEqual(poolIds(POOL).toSorted());
      expect(sections.map(({ key }) => key)).toEqual(
        TRUNKS.filter((trunk) => sections.some((section) => section.key === trunk)),
      );
      expect(listed.indexOf(focusTemplateId({ baseId: "release", kind: "rag" }))).toBeGreaterThan(
        listed.indexOf("release"),
      );
    });

    /** @scenario "Finder: coming-soon, coding-agent and org-wide templates are hidden" */
    it("offers no template still missing widget code", () => {
      expect(POOL.every(({ board }) => board.comingSoon === void 0)).toBe(true);
      expect(TEMPLATE_LIBRARY.some(({ board }) => board.comingSoon !== void 0)).toBe(true);
    });

    /** @scenario "Finder: coming-soon, coding-agent and org-wide templates are hidden" */
    it("keeps coding-agent and org-wide templates out of the finder", () => {
      const known = new Set(poolIds(TEMPLATE_LIBRARY));
      for (const template of CATALOGUE_TEMPLATES) {
        const hidden = template.scope === "org" || template.focusKind === "coding";
        expect(known.has(template.id), template.id).toBe(!hidden);
      }
    });
  });

  describe("when the member picks an agent type", () => {
    /** @scenario "Finder: an agent-type chip finds only the templates made for that type" */
    it("offers only the ready templates made for that type", () => {
      const voice = finderPool({ agentKind: "voice" });

      expect(poolIds(voice)).toEqual(
        poolIds(POOL.filter(({ board }) => catalogue.get(board.id)?.focusKind === "voice")),
      );
      expect(poolIds(voice)).toContain("calls");
      expect(poolIds(voice)).not.toContain("cockpit");
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
      expect(shownIds({ search })).toContain(id);
    });

    /** @scenario "AC102 Templates library: search matches name, job, widget questions and agent kinds" */
    it("leaves out templates the search does not match", () => {
      expect(shownIds({ search: "zzz-no-such-template" })).toEqual([]);
    });
  });

  describe("when the member picks a category", () => {
    /** @scenario "AC103 Templates library: one category chip and one agent-type chip narrow the finder" */
    it("shows only that category's templates, with the search applied", () => {
      const result = filterCatalogue({
        items: POOL,
        filters: { ...NO_CATALOGUE_FILTERS, trunk: "Profit", search: "cost" },
      });

      expect(result.length).toBeGreaterThan(0);
      for (const { board, trunk, searchText } of result) {
        expect(trunk, board.id).toBe("Profit");
        expect(searchText, board.id).toContain("cost");
      }
    });

    /** @scenario "AC103 Templates library: one category chip and one agent-type chip narrow the finder" */
    it("counts each category with the search applied, never another category", () => {
      const counts = trunkCounts({ items: POOL, search: "cost" });
      const searched = filterCatalogue({
        items: POOL,
        filters: { ...NO_CATALOGUE_FILTERS, search: "cost" },
      });

      expect(counts.all).toBe(searched.length);
      for (const trunk of TRUNKS) {
        expect(counts.byTrunk[trunk], trunk).toBe(
          searched.filter((template) => template.trunk === trunk).length,
        );
      }
    });
  });

  describe("given a view in the address", () => {
    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("writes the search and chips over the rest of the query, and reads them back", () => {
      const filters: CatalogueFilters = { search: "cost", trunk: "Profit", agentKind: "voice" };

      const query = templateFiltersQuery({ query: { other: "kept" }, filters });

      expect(query).toEqual({ other: "kept", q: "cost", trunk: "Profit", agent: "voice" });
      expect(templateFiltersFromQuery(query)).toEqual(filters);
    });

    /** @scenario "AC104 Templates library: the search and filters are kept in the address" */
    it("drops chip values it does not know", () => {
      expect(templateFiltersFromQuery({ trunk: "Growth", agent: "robot" })).toEqual(
        NO_CATALOGUE_FILTERS,
      );
    });
  });

  describe("given each template's preview", () => {
    const titles = new Map(CATALOGUE_WIDGETS.map(({ id, title }) => [id, title]));

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
