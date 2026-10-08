/**
 * The From LangWatch boards: catalogue templates rendered live and read-only, never stored,
 * so Dashboards opens on useful boards with no setup. Every widget on them has code.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import {
  CATALOGUE_TEMPLATES,
  type CatalogueTemplate,
  implementedWidget,
  stackWidgets,
} from "../catalogue/index.ts";
import type { BoardTemplateWidget } from "../templates/index.ts";
import { TEMPLATE_LIBRARY, type LibraryTemplate } from "./template-library.ts";

/**
 * The one From LangWatch list, in order; every surface follows it (the sidebar group and
 * the empty board's cards). Release check, then "Can I trust my numbers?", then where it breaks.
 */
export const CURATED_TEMPLATE_IDS = ["release", "data", "breaks"] as const;

/** One From LangWatch board: its template's words and its widgets laid out on the grid. */
export interface CuratedBoard {
  readonly templateId: string;
  readonly name: string;
  readonly job: string;
  readonly reportPrompt: string;
  readonly widgets: readonly BoardTemplateWidget[];
  /** Its card in the library, for the empty board's "Or start from a template". */
  readonly card: LibraryTemplate;
}

function curatedWidgets(template: CatalogueTemplate): BoardTemplateWidget[] {
  return stackWidgets(template.widgets.flatMap((id) => implementedWidget(id) ?? []));
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
