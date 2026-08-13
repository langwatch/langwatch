import { describe, expect, it } from "vitest";
import type { Field } from "../../types/dsl";
import {
  datasetColumnTypeToFieldType,
  fieldsToDatasetColumns,
} from "../datasetUtils";

describe("datasetUtils column/field type conversion", () => {
  describe("when a dataset column is typed image (URL)", () => {
    it("converts the column to the image field type, not str", () => {
      expect(datasetColumnTypeToFieldType("image")).toBe("image");
    });
  });

  describe("when node fields become demonstration dataset columns", () => {
    /** @scenario An image variable derives an image column in the demonstrations editor */
    it("keeps the image type on the derived column", () => {
      const fields: Field[] = [
        { identifier: "question", type: "str" },
        { identifier: "photo", type: "image" },
      ];

      expect(fieldsToDatasetColumns(fields)).toEqual([
        { name: "question", type: "string" },
        { name: "photo", type: "image" },
      ]);
    });
  });
});
