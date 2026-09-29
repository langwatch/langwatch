/**
 * A board template: a named set of stored widgets and where each sits on the
 * chart grid. Creating a board from one copies every widget into the board as
 * an ordinary, editable widget.
 */

import type { DashboardWidgetDefinition } from "../../../../model/dashboard-widget-definition.ts";

/** One widget a template places, as the chart grid in `model/chart-grid.ts` measures it. */
export interface BoardTemplateWidget {
  readonly key: string;
  readonly name: string;
  readonly definition: DashboardWidgetDefinition;
  readonly layout: { gridColumn: number; gridRow: number; colSpan: number; rowSpan: number };
}

/** The Agent Flight Deck, then one template per question-picker section, by section id. */
export type BoardTemplateId =
  | "agent-flight-deck"
  | "happen"
  | "change"
  | "threshold"
  | "compare"
  | "cost-source"
  | "tradeoff"
  | "why"
  | "howto";

export interface BoardTemplate {
  readonly id: BoardTemplateId;
  readonly name: string;
  readonly description: string;
  /** A short, user-facing line for the template card; falls back to `description`. */
  readonly summary?: string;
  readonly widgets: readonly BoardTemplateWidget[];
}
