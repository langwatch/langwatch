import { describe, expect, it } from "vitest";
import {
  HEADER_PARSE_MAX_BYTES,
  parseHeaderColumns,
} from "../parseHeaderColumns";

const file = (content: string, name: string) => new File([content], name);

describe("parseHeaderColumns", () => {
  describe("when the file is a CSV", () => {
    it("returns its header columns as default-string columns", async () => {
      const result = await parseHeaderColumns(
        file("question,answer,score\nq1,a1,5\n", "data.csv"),
      );
      expect(result).toEqual([
        { name: "question", type: "string" },
        { name: "answer", type: "string" },
        { name: "score", type: "string" },
      ]);
    });

    it("renames a reserved column name the way normalize does", async () => {
      const result = await parseHeaderColumns(file("id,value\n1,x\n", "d.csv"));
      expect(result?.[0]).toEqual({ name: "id_", type: "string" });
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
        { name: "a", type: "string" },
        { name: "b", type: "string" },
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
