/**
 * The template gallery from the catalogue: every template, built ones first. A template
 * whose widgets all have code is laid out and offered; the rest say how far along they are.
 */

import { CHART_GRID_COLUMNS } from "../../../../model/chart-grid.ts";
import type { BoardTemplate, BoardTemplateWidget } from "../../templates/model/board-template.ts";
import { CATALOGUE_TEMPLATES, type CatalogueTemplate } from "./catalogue-templates.ts";
import { implementedWidget } from "./widget-implementations.ts";

/** Widgets top to bottom: full-width ones on their own rows, half-width ones in pairs. */
export function stackWidgets(widgets: readonly BoardTemplateWidget[]): BoardTemplateWidget[] {
  const half = CHART_GRID_COLUMNS / 2;
  let row = 0;
  let open: { gridRow: number; rowSpan: number } | undefined;
  return widgets.map((widget) => {
    const { rowSpan, colSpan } = widget.layout;
    if (colSpan < CHART_GRID_COLUMNS && open) {
      const placed = { gridColumn: half, gridRow: open.gridRow, colSpan: half, rowSpan };
      row = Math.max(row, open.gridRow + Math.max(open.rowSpan, rowSpan));
      open = void 0;
      return { ...widget, layout: placed };
    }
    if (open) row = open.gridRow + open.rowSpan;
    open = void 0;
    const wide = colSpan >= CHART_GRID_COLUMNS;
    const placed = {
      gridColumn: 0,
      gridRow: row,
      colSpan: wide ? CHART_GRID_COLUMNS : half,
      rowSpan,
    };
    if (wide) row += rowSpan;
    else open = { gridRow: row, rowSpan };
    return { ...widget, layout: placed };
  });
}

function galleryTemplate(template: CatalogueTemplate): BoardTemplate {
  const built = template.widgets.flatMap((id) => implementedWidget(id) ?? []);
  const base = {
    id: template.id,
    name: template.name,
    description: template.job,
    trunk: template.trunk,
    reportPrompt: template.reportPrompt,
  };
  if (built.length < template.widgets.length) {
    return {
      ...base,
      widgets: [],
      comingSoon: { built: built.length, total: template.widgets.length },
    };
  }
  return { ...base, widgets: stackWidgets(built) };
}

/** Every catalogue template: the ones that can be made today, then those coming soon. */
export const GALLERY_TEMPLATES: readonly BoardTemplate[] = CATALOGUE_TEMPLATES.map(
  galleryTemplate,
).toSorted((a, b) => Number(a.comingSoon !== void 0) - Number(b.comingSoon !== void 0));
