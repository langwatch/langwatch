/**
 * The built widgets of "Can I trust my numbers?", keyed by catalogue id. Data health names
 * the widgets each missing field holds back, so it is built from the other widgets' builds.
 */

import { CATALOGUE_WIDGETS, isCodingWidget } from "../model/catalogue-widgets.ts";
import type { CatalogueWidgetBuild } from "./index.ts";
import * as sql from "./trust-queries.ts";
import { COST_ACCURACY_CODE, dataHealthCode, NOISE_CODE } from "./trust-widgets-code.ts";

/** The questions of the built widgets that read `field`, coding-agent widgets left out. */
function widgetsReading({
  field,
  builds,
}: {
  field: sql.HealthField;
  builds: Readonly<Record<string, CatalogueWidgetBuild>>;
}): string[] {
  return CATALOGUE_WIDGETS.filter((widget) => {
    const build = builds[widget.id];
    if (!build || isCodingWidget(widget)) return false;
    const queries = Object.values(build.queries);
    return (
      queries.some((query) => field.readBy.test(query)) ||
      widget.requirements.some((keys) => keys.includes(field.need))
    );
  }).map(({ question }) => question);
}

/** The three Trust widgets, given every other build. */
export function trustWidgetBuilds({
  builds,
}: {
  builds: Readonly<Record<string, CatalogueWidgetBuild>>;
}): Readonly<Record<string, CatalogueWidgetBuild>> {
  const unlocks = Object.fromEntries(
    sql.HEALTH_FIELDS.map((field) => [field.key, widgetsReading({ field, builds })]),
  );
  return {
    "data-health": {
      code: dataHealthCode({ unlocks }),
      queries: { fields: sql.FIELD_COVERAGE_SQL },
      width: "half",
      rows: 7,
    },
    "cost-accuracy": {
      code: COST_ACCURACY_CODE,
      queries: { trend: sql.UNPRICED_TREND_SQL, models: sql.UNPRICED_MODELS_SQL },
      width: "half",
      rows: 7,
    },
    noise: {
      code: NOISE_CODE,
      queries: { sources: sql.NOISE_SOURCES_SQL },
      width: "half",
      rows: 4,
    },
  };
}
