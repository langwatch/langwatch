import type { DatasetColumns, DatasetVersionRow } from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";

import { DatasetContentHasherService } from "../dataset-content-hasher.service.ts";

const COLUMNS: DatasetColumns = [{ name: "input", type: "string" }];

describe("DatasetContentHasherService", () => {
  const datasetContentHashOf = ({
    columns,
    rows,
  }: {
    columns: DatasetColumns;
    rows: DatasetVersionRow[];
  }) => {
    const hasher = DatasetContentHasherService.create({ columns });
    for (const row of rows) hasher.push(row);
    return hasher.digest().contentHash;
  };
  const rows = [{ id: "a", entry: { x: 1, y: 2 } }];

  /** @scenario "Saving unchanged content creates no version" */
  it("hashes the same content alike, whatever the key order", () => {
    expect(datasetContentHashOf({ columns: COLUMNS, rows })).toBe(
      datasetContentHashOf({ columns: COLUMNS, rows: [{ id: "a", entry: { y: 2, x: 1 } }] }),
    );
  });

  /** @scenario "Saving unchanged content creates no version" */
  it("hashes a column change as different content", () => {
    expect(datasetContentHashOf({ columns: COLUMNS, rows })).not.toBe(
      datasetContentHashOf({ columns: [{ name: "other", type: "string" }], rows }),
    );
  });
});
