/**
 * Which catalogue widgets have code: those with a build in `catalogue/widgets/`. A widget
 * without one is "Coming soon" wherever it is listed.
 */

import type { BoardTemplateWidget } from "../../templates/model/board-template.ts";
import { definition, full, half } from "../../templates/model/template-widget.ts";
import { CATALOGUE_WIDGET_BUILDS } from "../widgets/index.ts";
import { CATALOGUE_WIDGETS } from "./catalogue-widgets.ts";

const questionById = new Map(CATALOGUE_WIDGETS.map(({ id, question }) => [id, question] as const));

/** The stored widget for a catalogue widget, named by its question; undefined without code. */
export function implementedWidget(id: string): BoardTemplateWidget | undefined {
  const build = CATALOGUE_WIDGET_BUILDS[id];
  const question = questionById.get(id);
  if (!build || question === void 0) return void 0;
  const place = { gridRow: 0, rowSpan: build.rows };
  return {
    key: id,
    name: question,
    definition: definition({ code: build.code, queries: build.queries }),
    layout: build.width === "full" ? full(place) : half({ side: "left", ...place }),
  };
}

/** The catalogue widgets that have code, in catalogue order. */
export const IMPLEMENTED_WIDGET_IDS: readonly string[] = CATALOGUE_WIDGETS.map(
  ({ id }) => id,
).filter((id) => implementedWidget(id) !== void 0);
