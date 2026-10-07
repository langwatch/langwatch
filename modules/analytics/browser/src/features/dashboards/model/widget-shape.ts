/**
 * What a widget draws, as far as the changes worth suggesting go: one figure, a line over
 * time, or bars by group. A catalogue widget's shape is its question's; any other widget's
 * is read from its queries. Pure.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import type { DashboardWidgetDefinition } from "../../../model/dashboard-widget-definition.ts";
import { CATALOGUE_WIDGETS, type QuestionType } from "../catalogue/index.ts";

export type WidgetShape = "tile" | "line" | "bars";

/** A catalogue widget's shape, by the kind of question it answers. */
const QUESTION_SHAPES: Readonly<Record<QuestionType, WidgetShape>> = {
  happened: "tile",
  changed: "line",
  line: "line",
  compare: "bars",
  why: "bars",
  matters: "bars",
  prove: "tile",
};

const QUESTION_TYPES = new Map(CATALOGUE_WIDGETS.map(({ id, questionType }) => [id, questionType]));

/** A query bucketed by the board's grain draws over time; one grouped by anything draws bars. */
const OVER_TIME = /dashboard_context_granularity_seconds|toStartOf/i;
const GROUPED = /\bGROUP\s+BY\b/i;

export function widgetShape(
  definition: Pick<DashboardWidgetDefinition, "queries" | "source">,
): WidgetShape {
  const { source } = definition;
  const questionType =
    source?.kind === "catalogue" ? QUESTION_TYPES.get(source.catalogueId) : void 0;
  if (questionType) return QUESTION_SHAPES[questionType];
  const sqls = definition.queries.map(({ sql }) => sql);
  if (sqls.some((sql) => OVER_TIME.test(sql))) return "line";
  if (sqls.some((sql) => GROUPED.test(sql))) return "bars";
  return "tile";
}
