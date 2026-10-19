/**
 * The From LangWatch boards: catalogue templates rendered live and read-only, never stored.
 * Pure definitions, so the browser draws them and a server reads their widgets alike.
 * @see modules/dashboard/specs/dashboards-v2.feature
 */

import {
  CATALOGUE_TEMPLATES,
  type CatalogueTemplate,
  implementedWidget,
  stackWidgets,
} from "../catalogue/index.ts";
import type { BoardTemplateWidget } from "../templates/index.ts";

/**
 * The one From LangWatch list, in order; every surface follows it (the sidebar group and
 * the empty board's cards). Release check, then "Can I trust my numbers?", then where it breaks.
 */
export const CURATED_TEMPLATE_IDS = ["release", "data", "breaks"] as const;

/** One From LangWatch board: its template's words and its widgets laid out on the grid. */
export interface CuratedBoardDefinition {
  readonly templateId: string;
  readonly name: string;
  readonly job: string;
  readonly reportPrompt: string;
  readonly widgets: readonly BoardTemplateWidget[];
}

/** One widget on a From LangWatch board, found by its widget id. */
export interface CuratedBoardWidget {
  readonly id: string;
  readonly templateId: string;
  readonly widget: BoardTemplateWidget;
}

const TEMPLATE_WIDGET_PREFIX = "template:";

function curatedWidgets(template: CatalogueTemplate): BoardTemplateWidget[] {
  return stackWidgets(template.widgets.flatMap((id) => implementedWidget(id) ?? []));
}

function curatedBoardDefinition(templateId: string): CuratedBoardDefinition[] {
  const template = CATALOGUE_TEMPLATES.find(({ id }) => id === templateId);
  if (!template) return [];
  return [
    {
      templateId,
      name: template.name,
      job: template.job,
      reportPrompt: template.reportPrompt,
      widgets: curatedWidgets(template),
    },
  ];
}

/** The From LangWatch boards, in their one order. */
export const CURATED_BOARD_DEFINITIONS: readonly CuratedBoardDefinition[] =
  CURATED_TEMPLATE_IDS.flatMap(curatedBoardDefinition);

/** One From LangWatch board by its template id; undefined for any other id. */
export function curatedBoardDefinitionById(templateId: string): CuratedBoardDefinition | undefined {
  return CURATED_BOARD_DEFINITIONS.find((board) => board.templateId === templateId);
}

/** A From LangWatch widget's id, `template:<templateId>:<key>`: stable, never stored. */
export function templateWidgetId({ templateId, key }: { templateId: string; key: string }): string {
  return `${TEMPLATE_WIDGET_PREFIX}${templateId}:${key}`;
}

/** The From LangWatch widget a `template:` id names; undefined for any other id. */
export function curatedBoardWidgetById(widgetId: string): CuratedBoardWidget | undefined {
  if (!widgetId.startsWith(TEMPLATE_WIDGET_PREFIX)) return undefined;
  const [templateId = "", ...rest] = widgetId.slice(TEMPLATE_WIDGET_PREFIX.length).split(":");
  const key = rest.join(":");
  const widget = curatedBoardDefinitionById(templateId)?.widgets.find((w) => w.key === key);
  return widget ? { id: widgetId, templateId, widget } : undefined;
}
