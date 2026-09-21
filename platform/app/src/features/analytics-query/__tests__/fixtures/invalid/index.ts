/**
 * Specifications refused for being wrong rather than for being hostile: a
 * mistyped encoding, the wrong Vega-Lite version, a column that does not exist,
 * a dataset that was never registered.
 *
 * Text that is not JSON at all has no fixture — it cannot be a `.json` file, so
 * `parseVegaLiteSpecText` is exercised from the test instead.
 */

import type { LangWatchQLVegaRuleId } from "~/features/analytics-query/visualization/visualization.types";

import schemaInvalidEncodingType from "./schema-invalid-encoding-type.json";
import unknownDataset from "./unknown-dataset.json";
import unknownField from "./unknown-field.json";
import unknownSchemaVersion from "./unknown-schema-version.json";

export interface InvalidVegaFixture {
  readonly name: string;
  /** The rule this fixture must be refused by. */
  readonly refusedBy: LangWatchQLVegaRuleId;
  readonly spec: unknown;
}

export const INVALID_VEGA_FIXTURES: readonly InvalidVegaFixture[] = [
  {
    name: "schema-invalid-encoding-type",
    refusedBy: "spec.schema-invalid",
    spec: schemaInvalidEncodingType,
  },
  {
    name: "unknown-schema-version",
    refusedBy: "spec.unsupported-schema-version",
    spec: unknownSchemaVersion,
  },
  { name: "unknown-field", refusedBy: "field.unknown", spec: unknownField },
  {
    name: "unknown-dataset",
    refusedBy: "data.unknown-name",
    spec: unknownDataset,
  },
];

export {
  schemaInvalidEncodingType,
  unknownDataset,
  unknownField,
  unknownSchemaVersion,
};
