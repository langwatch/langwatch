import { describe, it, expect } from "vitest";

// Test the parseColumns logic (module-private, re-implemented for testing)
function parseColumns(
  columnsStr: string,
): Array<{ name: string; type: string }> {
  return columnsStr.split(",").map((col) => {
    const [name, type] = col.trim().split(":");
    if (!name || !type) {
      throw new Error(
        `Invalid column format: "${col.trim()}". Expected "name:type" (e.g., input:string)`,
      );
    }
    return { name: name.trim(), type: type.trim() };
  });
}

describe("parseColumns", () => {
  describe("when given valid column definitions", () => {
    it("parses single column", () => {
      expect(parseColumns("input:string")).toEqual([
        { name: "input", type: "string" },
      ]);
    });

    it("parses multiple columns", () => {
      expect(parseColumns("input:string,output:string")).toEqual([
        { name: "input", type: "string" },
        { name: "output", type: "string" },
      ]);
    });

    it("handles various types", () => {
      expect(
        parseColumns("text:string,count:number,active:boolean"),
      ).toEqual([
        { name: "text", type: "string" },
        { name: "count", type: "number" },
        { name: "active", type: "boolean" },
      ]);
    });

    it("trims whitespace", () => {
      expect(parseColumns(" input : string , output : string ")).toEqual([
        { name: "input", type: "string" },
        { name: "output", type: "string" },
      ]);
    });
  });

  describe("when given invalid column definitions", () => {
    it("throws on missing type", () => {
      expect(() => parseColumns("input")).toThrow(
        'Invalid column format: "input"',
      );
    });

    it("throws on empty string segment", () => {
      expect(() => parseColumns("input:string,")).toThrow(
        'Invalid column format: ""',
      );
    });
  });
});
