import { describe, it, expect } from "vitest";
import { parseColumns } from "../create";

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

    it("throws on extra colon segments", () => {
      expect(() => parseColumns("input:string:extra")).toThrow(
        'Invalid column format: "input:string:extra"',
      );
    });
  });
});
