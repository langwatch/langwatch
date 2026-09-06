import { describe, expect, it } from "vitest";
import { parseActiveProjections } from "./parseActiveProjections";

describe("parseActiveProjections", () => {
  describe("given a single projection name", () => {
    it("returns that name alone", () => {
      expect(parseActiveProjections("traces_fact")).toEqual(["traces_fact"]);
    });
  });

  describe("given multiple '+'-delimited names", () => {
    it("returns each name", () => {
      expect(parseActiveProjections("traces_fact+spans_fact+evals")).toEqual([
        "traces_fact",
        "spans_fact",
        "evals",
      ]);
    });

    describe("when the string has empty segments", () => {
      it("filters them out", () => {
        expect(parseActiveProjections("traces_fact++spans_fact+")).toEqual([
          "traces_fact",
          "spans_fact",
        ]);
      });
    });
  });

  describe("given an empty or missing value", () => {
    it("returns an empty array for an empty string", () => {
      expect(parseActiveProjections("")).toEqual([]);
    });

    it("returns an empty array for undefined", () => {
      expect(parseActiveProjections(undefined)).toEqual([]);
    });
  });
});
