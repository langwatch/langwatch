/**
 * Starting specification when opening Chart mode: smallest thing that draws the
 * current result without inventing transforms. Valid by construction.
 */

import { VEGA_LITE_SCHEMA_URL } from "./vega-lite-schema.ts";
import type { LangWatchQLDatasetColumn } from "./visualization-types.ts";

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
  readonly columns: readonly LangWatchQLDatasetColumn[];
  /** The registered dataset the starter reads. */
  readonly datasetName: string;
}

/**
 * Vega-Lite field names need escaping for '.', '[', ']' to avoid nested-field
 * syntax interpretation.
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
  const quantitative = typed.find((column) => column.encoding === "quantitative");
  const nominal =
    typed.find((column) => column.encoding === "nominal" && column.name !== TENANT_COLUMN) ??
    typed.find((column) => column.encoding === "nominal");
  const dimension = temporal ?? nominal;

  const base = {
    $schema: VEGA_LITE_SCHEMA_URL,
    data: { name: datasetName },
    mark: temporal !== void 0 ? { type: "line", point: true } : "bar",
  };

  if (dimension === void 0) {
    // Every column is a number: there is nothing to put on the other axis, so
    // the starter draws the first one and lets the member choose the rest.
    return quantitative === void 0
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
        quantitative === void 0
          ? { aggregate: "count", type: "quantitative" }
          : { field: quantitative.name, type: "quantitative" },
    },
  };
}

/** The starter specification as the editor's initial text. */
export function starterVegaLiteSpecText(input: StarterVegaLiteSpecInput): string {
  return `${JSON.stringify(starterVegaLiteSpec(input), null, 2)}\n`;
}
