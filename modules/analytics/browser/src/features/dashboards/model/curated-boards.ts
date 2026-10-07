/**
 * The From LangWatch boards: catalogue templates rendered live and read-only, never stored,
 * so Dashboards opens on useful boards with no setup. A widget with no query yet is laid out
 * where it sits and shown as not built, never with made-up numbers.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import { CHART_GRID_COLUMNS } from "../../../model/chart-grid.ts";
import {
  CATALOGUE_TEMPLATES,
  CATALOGUE_WIDGETS,
  type CatalogueTemplate,
  implementedWidget,
  stackWidgets,
} from "../catalogue/index.ts";
import type { BoardTemplateWidget } from "../templates/index.ts";
import { TABLE_ROWS } from "../templates/model/template-widget.ts";
import { TEMPLATE_LIBRARY, type LibraryTemplate } from "./template-library.ts";

/**
 * The one From LangWatch list, in order; every surface follows it (the sidebar group and
 * the empty board's cards). Release check, then "Can I trust my numbers?", then where it breaks.
 */
export const CURATED_TEMPLATE_IDS = ["release", "data", "breaks"] as const;

/** A widget on a From LangWatch board: one with code, or one still waiting for its query. */
export type CuratedWidget =
  | { readonly kind: "built"; readonly widget: BoardTemplateWidget }
  | {
      readonly kind: "not-built";
      readonly key: string;
      readonly name: string;
      readonly description: string;
      readonly layout: BoardTemplateWidget["layout"];
    };

/** One From LangWatch board: its template's words and its widgets laid out on the grid. */
export interface CuratedBoard {
  readonly templateId: string;
  readonly name: string;
  readonly job: string;
  readonly reportPrompt: string;
  readonly widgets: readonly CuratedWidget[];
  /** Its card in the library, for the empty board's "Or start from a template". */
  readonly card: LibraryTemplate;
}

/** A widget not built yet sits half wide at a table's height: its face is one short line. */
const NOT_BUILT_LAYOUT = {
  gridColumn: 0,
  gridRow: 0,
  colSpan: CHART_GRID_COLUMNS / 2,
  rowSpan: TABLE_ROWS,
};

const WIDGETS = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget]));

function curatedWidgets(template: CatalogueTemplate): CuratedWidget[] {
  const placed = template.widgets.flatMap((id) => {
    const built = implementedWidget(id);
    if (built)
      return [{ layout: built.layout, curated: { kind: "built", widget: built } as const }];
    const widget = WIDGETS.get(id);
    if (!widget) return [];
    return [
      {
        layout: NOT_BUILT_LAYOUT,
        curated: {
          kind: "not-built",
          key: id,
          name: widget.question,
          description: widget.why,
          layout: NOT_BUILT_LAYOUT,
        } as const,
      },
    ];
  });
  return stackWidgets(placed).map(({ layout, curated }) =>
    curated.kind === "built"
      ? { kind: "built", widget: { ...curated.widget, layout } }
      : { ...curated, layout },
  );
}

function curatedBoard(templateId: string): CuratedBoard[] {
  const template = CATALOGUE_TEMPLATES.find(({ id }) => id === templateId);
  const card = TEMPLATE_LIBRARY.find(({ board }) => board.id === templateId);
  if (!template || !card) return [];
  return [
    {
      templateId,
      name: template.name,
      job: template.job,
      reportPrompt: template.reportPrompt,
      widgets: curatedWidgets(template),
      card,
    },
  ];
}

/** The From LangWatch boards, in their one order. */
export const CURATED_BOARDS: readonly CuratedBoard[] = CURATED_TEMPLATE_IDS.flatMap(curatedBoard);

/** One From LangWatch board by its template id; undefined for any other id. */
export function curatedBoardById(templateId: string): CuratedBoard | undefined {
  return CURATED_BOARDS.find((board) => board.templateId === templateId);
}

/** The widgets "Duplicate to edit" copies: only built ones, as a board stores nothing else. */
export function curatedCopyWidgets(board: CuratedBoard): BoardTemplateWidget[] {
  return board.widgets.flatMap((widget) => (widget.kind === "built" ? [widget.widget] : []));
}
