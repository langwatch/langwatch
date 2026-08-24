import type { DatasetColumns, DatasetRecordInput } from "@langwatch/dataset-contract";
import { describe, expect, it } from "vitest";
import { convertDatasetRecordsToColumnTypes } from "../../src/records/convert-record-values";

const columns: DatasetColumns = [
  { name: "number", type: "number" },
  { name: "boolean", type: "boolean" },
  { name: "date", type: "date" },
  { name: "json", type: "json" },
  { name: "image", type: "image" },
];

describe("convertDatasetRecordsToColumnTypes", () => {
  it("converts CSV values according to their Dataset column types", () => {
    const records: DatasetRecordInput[] = [
      {
        id: "record-1",
        number: "12.5",
        boolean: "yes",
        date: "2026-08-25T12:00:00.000Z",
        json: '{"answer": 42}',
        image: "https://example.com/image.png",
      },
    ];

    expect(convertDatasetRecordsToColumnTypes(records, columns)).toEqual([
      {
        id: "record-1",
        number: 12.5,
        boolean: true,
        date: "2026-08-25",
        json: { answer: 42 },
        image: "https://example.com/image.png",
      },
    ]);
  });

  it("keeps malformed JSON and unrecognised booleans unchanged", () => {
    const records: DatasetRecordInput[] = [
      { id: "record-1", boolean: "maybe", json: "not-json" },
    ];

    expect(convertDatasetRecordsToColumnTypes(records, columns)).toEqual(records);
  });

  it("turns empty numeric values into null", () => {
    const records: DatasetRecordInput[] = [{ id: "record-1", number: "" }];

    expect(convertDatasetRecordsToColumnTypes(records, columns)).toEqual([
      { id: "record-1", number: null },
    ]);
  });
});
