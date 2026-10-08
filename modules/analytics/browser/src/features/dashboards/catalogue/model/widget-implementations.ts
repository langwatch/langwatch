/**
 * Which catalogue widgets have code: those with a build in `catalogue/widgets/`. A widget
 * without one is "Coming soon" wherever it is listed.
 */

import { BOARD_LWQL_VIEWS } from "../../model/board-lwql-views.ts";
import type { BoardTemplateWidget } from "../../templates/model/board-template.ts";
import { definition, full, half } from "../../templates/model/template-widget.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";
import { CATALOGUE_WIDGETS, type CatalogueWidget } from "./catalogue-widgets.ts";

const widgetById = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget] as const));

/** The card's info tip: what the panel is for, then why it matters, a blank line apart. */
const descriptionOf = ({ subtitle, why }: { subtitle: string; why: string }): string =>
  [subtitle, why].filter((part) => part.length > 0).join("\n\n");

/** The LangWatchQL views a built widget's queries read, so its prompt can name them. */
function viewsOf(id: string): string[] {
  const queries = Object.values(CATALOGUE_WIDGET_BUILDS[id]?.queries ?? {});
  const named = queries.flatMap((sql) => [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)/g)]);
  const views = new Set(named.map((match) => match[1]));
  return BOARD_LWQL_VIEWS.filter((view) => views.has(view));
}

/**
 * The widget's own prompt, naming the views its queries read when it does not yet. The
 * picker drafts it and the stored widget keeps it, so both hand Langy the same words.
 */
export function promptFor(widget: CatalogueWidget): string {
  const views = viewsOf(widget.id);
  if (views.length === 0 || views.some((view) => widget.prompt.includes(view))) {
    return widget.prompt;
  }
  return `${widget.prompt} Read it from the LangWatchQL views ${views.join(", ")}.`;
}

/**
 * The stored widget for a catalogue widget, named by its question, described by its
 * subtitle and why, and carrying its Langy prompt; undefined without code.
 */
export function implementedWidget(id: string): BoardTemplateWidget | undefined {
  const build = CATALOGUE_WIDGET_BUILDS[id];
  const widget = widgetById.get(id);
  if (!build || widget === void 0) return void 0;
  const place = { gridRow: 0, rowSpan: build.rows };
  return {
    key: id,
    name: widget.question,
    definition: {
      ...definition({ code: build.code, queries: build.queries, scope: build.scope }),
      description: descriptionOf({ subtitle: build.code.description, why: widget.why }),
      prompt: promptFor(widget),
    },
    layout: build.width === "full" ? full(place) : half({ side: "left", ...place }),
  };
}

/** The catalogue widgets that have code, in catalogue order. */
export const IMPLEMENTED_WIDGET_IDS: readonly string[] = CATALOGUE_WIDGETS.map(
  ({ id }) => id,
).filter((id) => implementedWidget(id) !== void 0);
