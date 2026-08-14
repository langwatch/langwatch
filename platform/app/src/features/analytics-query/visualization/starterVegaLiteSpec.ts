/**
 * The specification a member starts from when they first open Chart mode.
 *
 * Deliberately the smallest thing that draws the result they are already
 * looking at: one categorical or time column against one number. It is a
 * starting point to edit, not a guess at what they meant — so it never invents
 * a transform, never aggregates unless there is nothing to aggregate over, and
 * never picks a column that is not in the result.
 *
 * Whatever it returns is valid: `starterVegaLiteSpec.unit.test.ts` runs every
 * shape it can produce through the real validator.
 */

import { VEGA_LITE_SCHEMA_URL } from "./vegaLiteSchema";
import type { GovernedDatasetColumn } from "./visualization.types";

/** ClickHouse types that belong on a time axis. */
const TEMPORAL_TYPE = /\b(Date|Date32|DateTime|DateTime64)\b/;

/** ClickHouse types that belong on a value axis. */
const QUANTITATIVE_TYPE = /\b(U?Int\d+|Float\d+|Decimal\d*)\b/;

export type StarterEncodingType = "temporal" | "quantitative" | "nominal";

/**
 * Constant by construction: the server pins every result to one tenant, so a
 * chart with this on an axis is a single bar of everything. The starter picks
 * another dimension when there is one; a member may still chart it by hand.
 */
const TENANT_COLUMN = "TenantId";

/** How a result column is read when a chart is drawn over it. */
export function starterEncodingType(type: string): StarterEncodingType {
  if (TEMPORAL_TYPE.test(type)) return "temporal";
  if (QUANTITATIVE_TYPE.test(type)) return "quantitative";
  return "nominal";
}

export interface StarterVegaLiteSpecInput {
  readonly columns: readonly GovernedDatasetColumn[];
  /** The registered dataset the starter reads. */
  readonly datasetName: string;
}

/**
 * A column name, safe to use as a Vega-Lite `field` reference.
 *
 * Vega-Lite reads an unescaped `.`, `[` or `]` as nested-field or array-index
 * syntax rather than a literal character in the name (`fieldIsKnown` in
 * `vegaLiteFields.ts` reverses this same escaping when it checks a spec's
 * field against the columns a response actually carried). A result column
 * named e.g. `a.b` would otherwise resolve to the wrong path, or to nothing.
 */
function escapeVegaLiteField(name: string): string {
  return name.replace(/[\\.[\]]/g, "\\$&");
}

export function starterVegaLiteSpec({
  columns,
  datasetName,
}: StarterVegaLiteSpecInput): Record<string, unknown> {
  const typed = columns.map((column) => ({
    name: escapeVegaLiteField(column.name),
    encoding: starterEncodingType(column.type),
  }));

  const temporal = typed.find((column) => column.encoding === "temporal");
  const quantitative = typed.find(
    (column) => column.encoding === "quantitative",
  );
  const nominal =
    typed.find(
      (column) =>
        column.encoding === "nominal" && column.name !== TENANT_COLUMN,
    ) ?? typed.find((column) => column.encoding === "nominal");
  const dimension = temporal ?? nominal;

  const base = {
    $schema: VEGA_LITE_SCHEMA_URL,
    data: { name: datasetName },
    mark: temporal !== undefined ? { type: "line", point: true } : "bar",
  };

  if (dimension === undefined) {
    // Every column is a number: there is nothing to put on the other axis, so
    // the starter draws the first one and lets the member choose the rest.
    return quantitative === undefined
      ? base
      : {
          ...base,
          encoding: {
            y: { field: quantitative.name, type: "quantitative" },
          },
        };
  }

  return {
    ...base,
    encoding: {
      x: { field: dimension.name, type: dimension.encoding },
      y:
        quantitative === undefined
          ? { aggregate: "count", type: "quantitative" }
          : { field: quantitative.name, type: "quantitative" },
    },
  };
}

/** The starter specification as the editor's initial text. */
export function starterVegaLiteSpecText(
  input: StarterVegaLiteSpecInput,
): string {
  return `${JSON.stringify(starterVegaLiteSpec(input), null, 2)}\n`;
}
