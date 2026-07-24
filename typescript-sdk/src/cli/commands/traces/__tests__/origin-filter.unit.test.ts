import { describe, expect, it } from "vitest";
import { parseOriginOption } from "../origin-filter";

describe("parseOriginOption()", () => {
  describe("when no origin is given", () => {
    it("returns undefined so no filter is sent", () => {
      expect(parseOriginOption(undefined)).toBeUndefined();
    });
  });

  describe("when a single origin is given", () => {
    it("returns a single-element list", () => {
      expect(parseOriginOption("application")).toEqual(["application"]);
    });
  });

  describe("when comma-separated origins are given", () => {
    it("splits into one value per origin", () => {
      expect(parseOriginOption("application,evaluation")).toEqual([
        "application",
        "evaluation",
      ]);
    });

    it("trims whitespace around each value", () => {
      expect(parseOriginOption(" application , langy ")).toEqual([
        "application",
        "langy",
      ]);
    });

    it("drops empty segments from stray commas", () => {
      expect(parseOriginOption("application,,evaluation,")).toEqual([
        "application",
        "evaluation",
      ]);
    });
  });

  describe("when the value holds no origins at all", () => {
    it("returns undefined for an empty string", () => {
      expect(parseOriginOption("")).toBeUndefined();
    });

    it("returns undefined for commas and whitespace only", () => {
      expect(parseOriginOption(" , , ")).toBeUndefined();
    });
  });
});
