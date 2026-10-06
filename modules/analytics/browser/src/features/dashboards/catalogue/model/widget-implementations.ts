/**
 * Which catalogue widgets have code: those with a build in `catalogue/widgets/`. A widget
 * without one is "Coming soon" wherever it is listed.
 */

import type { BoardTemplateWidget } from "../../templates/model/board-template.ts";
import { definition, full, half } from "../../templates/model/template-widget.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";
import { CATALOGUE_WIDGETS } from "./catalogue-widgets.ts";

const widgetById = new Map(CATALOGUE_WIDGETS.map((widget) => [widget.id, widget] as const));

/** The card's info tip: what the panel is for, then why it matters, a blank line apart. */
const descriptionOf = ({ subtitle, why }: { subtitle: string; why: string }): string =>
  [subtitle, why].filter((part) => part.length > 0).join("\n\n");

/**
 * The stored widget for a catalogue widget, named by its question and described by its
 * subtitle and why; undefined without code.
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
      ...definition({ code: build.code, queries: build.queries }),
      description: descriptionOf({ subtitle: build.code.description, why: widget.why }),
    },
    layout: build.width === "full" ? full(place) : half({ side: "left", ...place }),
  };
}

/** The catalogue widgets that have code, in catalogue order. */
export const IMPLEMENTED_WIDGET_IDS: readonly string[] = CATALOGUE_WIDGETS.map(
  ({ id }) => id,
).filter((id) => implementedWidget(id) !== void 0);
