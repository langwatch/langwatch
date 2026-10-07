/**
 * The gallery holds every catalogue template as a board. One whose widgets all have code is
 * laid out on the grid; the rest hold no widgets and say how many are built.
 */

import { describe, expect, it } from "vitest";

import { CHART_GRID_COLUMNS } from "../../../../model/chart-grid.ts";
import { CATALOGUE_TEMPLATES, GALLERY_TEMPLATES } from "../index.ts";

const ready = GALLERY_TEMPLATES.filter(({ comingSoon }) => comingSoon === void 0);
const soon = GALLERY_TEMPLATES.filter(({ comingSoon }) => comingSoon !== void 0);

describe("given the template gallery", () => {
  /** @scenario "AC17 Only what is built is offered" */
  it("holds every catalogue template once, in catalogue order", () => {
    expect(GALLERY_TEMPLATES.map(({ id }) => id)).toEqual(CATALOGUE_TEMPLATES.map(({ id }) => id));
    expect(ready.length).toBeGreaterThan(0);
  });

  /** @scenario "AC17 Only what is built is offered" */
  it("says how far a coming-soon template is built, and holds no widgets yet", () => {
    for (const { id, comingSoon, widgets } of soon) {
      const total = CATALOGUE_TEMPLATES.find((template) => template.id === id)?.widgets.length;
      expect(comingSoon?.total, id).toBe(total);
      expect(comingSoon?.built, id).toBeLessThan(comingSoon?.total ?? 0);
      expect(widgets, id).toEqual([]);
    }
  });

  /** @scenario "AC17 Only what is built is offered" */
  it("lays a ready template's widgets out inside the grid, none overlapping", () => {
    for (const { id, widgets } of ready) {
      const cells = widgets.flatMap(({ layout }) =>
        Array.from({ length: layout.colSpan * layout.rowSpan }, (_, index) => {
          expect(layout.gridColumn + layout.colSpan, id).toBeLessThanOrEqual(CHART_GRID_COLUMNS);
          return `${layout.gridColumn + (index % layout.colSpan)}:${layout.gridRow + Math.floor(index / layout.colSpan)}`;
        }),
      );
      expect(new Set(cells).size, id).toBe(cells.length);
    }
  });

  /** @scenario "AC18 Every widget and template carries a default Langy prompt" */
  it("gives every template a report prompt that names it", () => {
    for (const template of CATALOGUE_TEMPLATES) {
      expect(template.reportPrompt, template.id).toContain(template.name);
    }
    for (const { id, reportPrompt } of GALLERY_TEMPLATES) expect(reportPrompt, id).toBeTruthy();
  });
});
