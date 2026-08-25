/**
 * The dataset registry every fixture is validated against.
 *
 * `query_result` is the dataset the first workbench actually supplies;
 * `model_catalog` exists so the multi-dataset renderer contract and the lookup
 * rules have a second registered name to resolve against.
 */

import type {
  DatasetRowCounts,
  LangWatchQLDatasetColumn,
} from "../../src/visualization/visualization-types";

export const LWQL_FIXTURE_COLUMNS: Readonly<
  Record<string, readonly LangWatchQLDatasetColumn[]>
> = {
  query_result: [
    { name: "model", type: "String" },
    { name: "total", type: "UInt64" },
    { name: "latency", type: "Float64" },
    { name: "bucket", type: "DateTime" },
    { name: "series", type: "String" },
    { name: "payload", type: "String" },
  ],
  model_catalog: [
    { name: "model", type: "String" },
    { name: "vendor", type: "String" },
  ],
};

export const LWQL_FIXTURE_ROW_COUNTS: DatasetRowCounts = {
  query_result: 500,
  model_catalog: 20,
};
