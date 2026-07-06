import { describe, expect, it } from "vitest";
import {
  HEADER_PARSE_MAX_BYTES,
  parseHeaderColumns,
} from "../parseHeaderColumns";

const file = (content: string, name: string) => new File([content], name);

describe("parseHeaderColumns", () => {
  describe("when the file is a CSV", () => {
    /** @scenario Choosing a file shows its columns to confirm before uploading */
    it("returns its header columns as default-string columns", async () => {
      const result = await parseHeaderColumns(
        file("question,answer,score\nq1,a1,5\n", "data.csv"),
      );
      // `sourceHeader` mirrors the canonical name — it's the immutable binding
      // the normalize job uses so the confirm UI can rename + drag-reorder.
      expect(result).toEqual([
        { name: "question", type: "string", sourceHeader: "question" },
        { name: "answer", type: "string", sourceHeader: "answer" },
        { name: "score", type: "string", sourceHeader: "score" },
      ]);
    });

    /** @scenario A reserved column name is corrected before I confirm */
    it("renames a reserved column name the way normalize does", async () => {
      const result = await parseHeaderColumns(file("id,value\n1,x\n", "d.csv"));
      // The reserved-rename applies to BOTH name and sourceHeader — normalize
      // reserved-renames the file header too, so the binding stays aligned.
      expect(result?.[0]).toEqual({
        name: "id_",
        type: "string",
        sourceHeader: "id_",
      });
    });

    it("dedupes repeated header names so they stay 1:1 with parsed rows", async () => {
      const result = await parseHeaderColumns(file("col,col\n1,2\n", "d.csv"));
      expect(result?.map((c) => c.name)).toEqual(["col", "col_1"]);
    });
  });

  describe("when the file is JSONL", () => {
    it("returns the first object's keys as columns", async () => {
      const result = await parseHeaderColumns(
        file('{"a":"1","b":"x"}\n{"a":"2","b":"y"}\n', "data.jsonl"),
      );
      expect(result).toEqual([
        { name: "a", type: "string", sourceHeader: "a" },
        { name: "b", type: "string", sourceHeader: "b" },
      ]);
    });
  });

  describe("when the file is a JSON array", () => {
    it("returns the first element's keys as columns", async () => {
      const result = await parseHeaderColumns(
        file('[{"x":1,"y":2},{"x":3,"y":4}]', "data.json"),
      );
      expect(result?.map((c) => c.name)).toEqual(["x", "y"]);
    });

    it("brace-matches the first object when the array is truncated by the slice", async () => {
      // A small first object followed by enough trailing bytes that the array
      // itself can't be parsed whole — the brace-matcher still finds object one.
      const tail = `,{"x":2,"y":"${"z".repeat(1000)}"}`.repeat(50);
      const result = await parseHeaderColumns(
        file(`[{"x":1,"y":2}${tail}]`, "data.json"),
      );
      expect(result?.map((c) => c.name)).toEqual(["x", "y"]);
    });

    it("returns null when the first object does not fit the read slice", async () => {
      // First object's value alone exceeds the slice, so it never closes → no
      // header can be determined; caller uploads without confirm.
      const giant = "x".repeat(HEADER_PARSE_MAX_BYTES + 1024);
      const result = await parseHeaderColumns(
        file(`[{"a":"${giant}"`, "data.json"),
      );
      expect(result).toBeNull();
    });
  });

  describe("when the header cannot be determined", () => {
    it("returns null for an unsupported extension", async () => {
      expect(
        await parseHeaderColumns(file("a,b\n1,2\n", "data.txt")),
      ).toBeNull();
    });

    it("returns null for an empty file", async () => {
      expect(await parseHeaderColumns(file("", "data.csv"))).toBeNull();
    });
  });
});
