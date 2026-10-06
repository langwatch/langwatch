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

/** A template's id: the catalogue template's, or an earlier template's. */
export type BoardTemplateId = string;

/** How far a catalogue template is built; it is offered only once every widget has code. */
export interface TemplateProgress {
  readonly built: number;
  readonly total: number;
}

export interface BoardTemplate {
  readonly id: BoardTemplateId;
  readonly name: string;
  readonly description: string;
  /** A short, user-facing line for the template card; falls back to `description`. */
  readonly summary?: string;
  readonly widgets: readonly BoardTemplateWidget[];
  /** The question-tree trunk the template serves; picks its card's icon. */
  readonly trunk?: string;
  /** Set while some of its widgets have no code: the card says "Coming soon". */
  readonly comingSoon?: TemplateProgress;
  /** What Langy is drafted with once a board is made from the template. */
  readonly reportPrompt?: string;
}
