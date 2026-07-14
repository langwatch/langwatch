import { describe, it, expect } from "vitest";
import { parseColumns } from "../create";

describe("parseColumns()", () => {
  describe("when given valid column definitions", () => {
    it("parses a single column", () => {
      const result = parseColumns("input:string");
      expect(result).toEqual([{ name: "input", type: "string" }]);
    });

    it("parses multiple columns", () => {
      const result = parseColumns("input:string,output:string,score:number");
      expect(result).toEqual([
        { name: "input", type: "string" },
        { name: "output", type: "string" },
        { name: "score", type: "number" },
      ]);
    });

    it("trims whitespace around names and types", () => {
      const result = parseColumns(" input : string , output : number ");
      expect(result).toEqual([
        { name: "input", type: "string" },
        { name: "output", type: "number" },
      ]);
    });
  });

  describe("when given invalid column definitions", () => {
    it("throws on missing type", () => {
      expect(() => parseColumns("input")).toThrow(
        'Invalid column format: "input"',
      );
    });

    it("throws on empty name", () => {
      expect(() => parseColumns(":string")).toThrow(
        'Invalid column format: ":string"',
      );
    });

    it("throws on empty type", () => {
      expect(() => parseColumns("input:")).toThrow(
        'Invalid column format: "input:"',
      );
    });

    it("throws on extra colons", () => {
      expect(() => parseColumns("input:string:extra")).toThrow(
        'Invalid column format: "input:string:extra"',
      );
    });
  });
});
