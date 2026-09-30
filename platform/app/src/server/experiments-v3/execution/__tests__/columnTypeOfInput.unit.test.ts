/**
 * What a target input reads its value as.
 *
 * @see specs/experiments-v3/attachment-inputs.feature
 */
import { describe, expect, it } from "vitest";
import { columnTypeOfInputFor } from "../orchestrator";
import type { ExecutionCell } from "../types";

const DATASET_ID = "dataset-1";

const datasetColumns = [
  { id: "c1", name: "picture", type: "image" },
  { id: "c2", name: "notes", type: "string" },
];

const cellWith = ({
  mappings,
  inputs,
}: {
  mappings: Record<string, unknown>;
  inputs: Array<{ identifier: string; type: string }>;
}): ExecutionCell =>
  ({
    rowIndex: 0,
    targetId: "target-1",
    targetConfig: {
      id: "target-1",
      type: "agent",
      inputs,
      outputs: [],
      mappings: { [DATASET_ID]: mappings },
    },
    evaluatorConfigs: [],
    datasetEntry: { _datasetId: DATASET_ID },
  }) as unknown as ExecutionCell;

describe("given an input mapped to a dataset column", () => {
  describe("when the column type is asked for", () => {
    it("answers with the column's own type", () => {
      const columnTypeOf = columnTypeOfInputFor({
        cell: cellWith({
          mappings: {
            attachment: {
              type: "source",
              source: "dataset",
              sourceField: "picture",
            },
          },
          inputs: [{ identifier: "attachment", type: "file" }],
        }),
        datasetColumns,
      });

      expect(columnTypeOf("attachment")).toBe("image");
    });
  });
});

describe("given an input holding a fixed value", () => {
  describe("when the target declares the field as a file", () => {
    /** @scenario "A fixed address in a file input is read as an attachment" */
    it("answers with the declared field type", () => {
      const columnTypeOf = columnTypeOfInputFor({
        cell: cellWith({
          mappings: {
            attachment: { type: "value", value: "https://example.com/a.pdf" },
          },
          inputs: [{ identifier: "attachment", type: "file" }],
        }),
        datasetColumns,
      });

      expect(columnTypeOf("attachment")).toBe("file");
    });
  });

  describe("when the target declares the field as text", () => {
    it("answers with nothing, so the value stays the sentence it is", () => {
      const columnTypeOf = columnTypeOfInputFor({
        cell: cellWith({
          mappings: {
            input: { type: "value", value: "see https://example.com/a.pdf" },
          },
          inputs: [{ identifier: "input", type: "str" }],
        }),
        datasetColumns,
      });

      expect(columnTypeOf("input")).toBeUndefined();
    });
  });
});

describe("given a row that names no dataset", () => {
  describe("when the target declares the field as an image", () => {
    it("still answers with the declared field type", () => {
      const cell = cellWith({
        mappings: {},
        inputs: [{ identifier: "picture", type: "image" }],
      });
      cell.datasetEntry = {};

      const columnTypeOf = columnTypeOfInputFor({ cell, datasetColumns });

      expect(columnTypeOf("picture")).toBe("image");
    });
  });
});
