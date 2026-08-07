/**
 * Specifications the governed policy admits, including one sitting exactly on
 * each ceiling that can be reached with a checked-in file.
 */

import atLimitInteractiveParams from "./at-limit-interactive-params.json";
import atLimitLayers from "./at-limit-layers.json";
import atLimitNestingDepth from "./at-limit-nesting-depth.json";
import atLimitTransforms from "./at-limit-transforms.json";
import atLimitUnitViews from "./at-limit-unit-views.json";
import barOverQueryResult from "./bar-over-query-result.json";
import lookupBetweenRegisteredDatasets from "./lookup-between-registered-datasets.json";
import multiSeriesTimeLine from "./multi-series-time-line.json";
import repeatOverRegisteredColumns from "./repeat-over-registered-columns.json";
import transformCreatedFields from "./transform-created-fields.json";

export interface ValidVegaFixture {
  readonly name: string;
  readonly spec: unknown;
}

export const VALID_VEGA_FIXTURES: readonly ValidVegaFixture[] = [
  { name: "bar-over-query-result", spec: barOverQueryResult },
  { name: "multi-series-time-line", spec: multiSeriesTimeLine },
  {
    name: "lookup-between-registered-datasets",
    spec: lookupBetweenRegisteredDatasets,
  },
  { name: "transform-created-fields", spec: transformCreatedFields },
  { name: "repeat-over-registered-columns", spec: repeatOverRegisteredColumns },
  { name: "at-limit-unit-views", spec: atLimitUnitViews },
  { name: "at-limit-layers", spec: atLimitLayers },
  { name: "at-limit-transforms", spec: atLimitTransforms },
  { name: "at-limit-interactive-params", spec: atLimitInteractiveParams },
  { name: "at-limit-nesting-depth", spec: atLimitNestingDepth },
];

export {
  atLimitInteractiveParams,
  atLimitLayers,
  atLimitNestingDepth,
  atLimitTransforms,
  atLimitUnitViews,
  barOverQueryResult,
  lookupBetweenRegisteredDatasets,
  multiSeriesTimeLine,
  repeatOverRegisteredColumns,
  transformCreatedFields,
};
