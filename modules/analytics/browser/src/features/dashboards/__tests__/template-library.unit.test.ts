/**
 * The templates finder's pool, category chip, counts, sections and address.
 * @see modules/dashboard/specs/dashboards-finder.feature
 */

import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CHART_GRID_COLUMNS } from "../../../model/chart-grid.ts";
import {
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  focusTemplateId,
  implementedWidget,
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
const titles = new Map(CATALOGUE_WIDGETS.map(({ id, title }) => [id, title]));
const POOL = finderPool({});
const poolIds = (templates: readonly LibraryTemplate[]) => templates.map(({ board }) => board.id);

const unbuiltPreviewWidgets = () =>
  TEMPLATE_LIBRARY.filter(({ board }) => !TEMPLATE_PREVIEW_IDS.has(board.id))
    .flatMap(({ preview }) => (preview.kind === "layout" ? preview.widgets : []))
    .filter(({ key }) => implementedWidget(key) === undefined);

/** A card the voice chip lists is its template made for voice, under the template's own name. */
function expectMadeForVoice(template: LibraryTemplate) {
  const made = catalogue.get(template.board.id.split("__")[0]!)!;
  const isForVoice = made.focusKind === "voice" || made.byAgentKind.voice !== void 0;
  expect(isForVoice, made.id).toBe(true);
  expect(template.board.name, made.id).toBe(made.name);
}

/** A card without a captured image sketches its widgets by title, inside the board's columns. */
function expectSketchedByTitle({ board, preview }: LibraryTemplate) {
  expect(preview.kind, board.id).toBe("layout");
  if (preview.kind !== "layout") return;
  const widgetIds = catalogue.get(board.id)?.widgets ?? [];
  expect(
    preview.widgets.map(({ title }) => title),
    board.id,
  ).toEqual(widgetIds.map((id) => titles.get(id)));
  for (const { key, layout } of preview.widgets) {
    expect(layout.gridColumn + layout.colSpan, key).toBeLessThanOrEqual(CHART_GRID_COLUMNS);
  }
}

describe("the templates finder", () => {
  describe("given no agent type picked", () => {
    /** @scenario "AC101 Templates library: All lists one template per job, most needed first" */
    it("lists every ready template once, most needed first, with no copy per agent kind", () => {
      const ids = poolIds(POOL);
      const order = CATALOGUE_TEMPLATES.map(({ id }) => id);

      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.slice(0, 3)).toEqual(["cockpit", "answers", "change"]);
      expect(POOL[0]?.board.name).toBe("My agent at a glance");
      expect(ids.map((id) => order.indexOf(id))).toEqual(
        ids.map((id) => order.indexOf(id)).toSorted((a, b) => a - b),
      );
      expect(ids.some((id) => id.includes("__"))).toBe(false);
      expect(new Set(POOL.slice(0, 4).map(({ trunk }) => trunk)).size).toBeGreaterThan(1);
    });

    /** @scenario "AC101 Templates library: All lists one template per job, most needed first" */
    it("keeps the same order under a category heading", () => {
      const sections = templateSections({ templates: POOL });
      const protect = sections.find(({ key }) => key === "Protect")!;

      expect(poolIds(protect.items)).toEqual(
        poolIds(POOL).filter((id) => catalogue.get(id)?.trunk === "Protect"),
      );
      expect(sections.map(({ key }) => key)).toEqual(
        TRUNKS.filter((trunk) => sections.some((section) => section.key === trunk)),
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
    /**
     * @scenario "Finder: an agent-type chip finds only the templates made for that type"
     * @scenario "Finder: a template adapts to the agent kind instead of listing a copy per kind"
     */
    it("offers only the ready templates made for that type, each adapted to it", () => {
      const voice = finderPool({ agentKind: "voice" });
      const cockpit = voice.find(
        ({ board }) => board.id === focusTemplateId({ baseId: "cockpit", kind: "voice" }),
      )!;

      expect(poolIds(voice)).toContain("calls");
      expect(poolIds(voice)).not.toContain("cockpit");
      expect(cockpit.board.name).toBe("My agent at a glance");
      expect(cockpit.focusKind).toBe("voice");
      expect(cockpit.board.widgets.map(({ key }) => key)).toContain("voice-task-success");
      for (const template of voice) expectMadeForVoice(template);
    });
  });

  describe("when the member picks a category", () => {
    /** @scenario "AC103 Templates library: one category chip and one agent-type chip narrow the finder" */
    it("shows only that category's templates", () => {
      const result = filterCatalogue({
        items: POOL,
        filters: { ...NO_CATALOGUE_FILTERS, trunk: "Profit" },
      });

      expect(result.length).toBeGreaterThan(0);
      for (const { board, trunk } of result) expect(trunk, board.id).toBe("Profit");
    });

    /** @scenario "AC103 Templates library: one category chip and one agent-type chip narrow the finder" */
    it("counts each category's own templates, never another category's", () => {
      const counts = trunkCounts({ items: POOL, search: "" });

      expect(counts.all).toBe(POOL.length);
      for (const trunk of TRUNKS) {
        expect(counts.byTrunk[trunk], trunk).toBe(
          POOL.filter((template) => template.trunk === trunk).length,
        );
      }
    });
  });

  describe("given a view in the address", () => {
    /** @scenario "AC104 Templates library: the filters are kept in the address" */
    it("writes the chips over the rest of the query, and reads them back", () => {
      const filters: CatalogueFilters = { search: "", trunk: "Profit", agentKind: "voice" };

      const query = templateFiltersQuery({ query: { other: "kept" }, filters });

      expect(query).toEqual({ other: "kept", trunk: "Profit", agent: "voice" });
      expect(templateFiltersFromQuery(query)).toEqual(filters);
    });

    /** @scenario "AC104 Templates library: the filters are kept in the address" */
    it("reads no search from an old address", () => {
      expect(templateFiltersFromQuery({ q: "cost" })).toEqual(NO_CATALOGUE_FILTERS);
    });

    /** @scenario "AC104 Templates library: the filters are kept in the address" */
    it("drops chip values it does not know", () => {
      expect(templateFiltersFromQuery({ trunk: "Growth", agent: "robot" })).toEqual(
        NO_CATALOGUE_FILTERS,
      );
    });
  });

  describe("given each template's preview", () => {
    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("shows the captured image of a template that has one", () => {
      expect(TEMPLATE_PREVIEW_IDS.size).toBeGreaterThan(0);
      for (const { board, preview } of TEMPLATE_LIBRARY) {
        if (!TEMPLATE_PREVIEW_IDS.has(board.id)) continue;
        expect(preview, board.id).toEqual({
          kind: "image",
          src: {
            light: templatePreviewSrc({ templateId: board.id, theme: "light" }),
            dark: templatePreviewSrc({ templateId: board.id, theme: "dark" }),
          },
        });
      }
    });

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("ships a light and a dark image file for every template it calls captured", () => {
      const publicDir = "../../../../../../../apps/ui/public";
      for (const templateId of TEMPLATE_PREVIEW_IDS) {
        for (const theme of ["light", "dark"] as const) {
          const src = templatePreviewSrc({ templateId, theme });
          expect(existsSync(new URL(`${publicDir}${src}`, import.meta.url)), src).toBe(true);
        }
      }
    });

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("sketches every other template's widgets by title, inside the board's columns", () => {
      const sketched = TEMPLATE_LIBRARY.filter(({ board }) => !TEMPLATE_PREVIEW_IDS.has(board.id));
      expect(sketched.length).toBeGreaterThan(0);
      for (const template of sketched) expectSketchedByTitle(template);
    });

    /** @scenario "AC107d Templates library: a card previews the template's real board" */
    it("sketches every unbuilt widget at the board's default height", () => {
      const unbuilt = unbuiltPreviewWidgets();

      expect(unbuilt.length).toBeGreaterThan(0);
      expect(unbuilt.map(({ key, layout }) => [key, layout.rowSpan])).toEqual(
        unbuilt.map(({ key }) => [key, 5]),
      );
    });
  });
});
