/**
 * Where a widget made on a board says it came from: a catalogue pick or template carries its
 * catalogue widget's id, a widget written in the editor says code. Pure.
 * @see modules/dashboard/specs/dashboards-widget-flow.feature
 */

import type { DashboardWidgetSource } from "@langwatch/analytics-contract/dashboard-widget-definition";

/** A widget written in the editor, such as the blank one "Skip" opens. */
export const CODE_SOURCE: DashboardWidgetSource = { kind: "code" };

/** A widget built from the catalogue, by a pick in "Add a widget" or from a template. */
export function catalogueSource(catalogueId: string): DashboardWidgetSource {
  return { kind: "catalogue", catalogueId };
}
