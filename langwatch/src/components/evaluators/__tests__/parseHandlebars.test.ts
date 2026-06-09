import { describe, expect, it } from "vitest";
import { parseHandlebars } from "../parseHandlebars";

describe("parseHandlebars", () => {
  it("extracts variable names from a prompt", () => {
    expect(
      parseHandlebars("Compare {{answer_a}} with {{answer_b}} on {{input}}")
    ).toEqual(["answer_a", "answer_b", "input"]);
  });

  it("deduplicates repeated variables", () => {
    expect(parseHandlebars("{{input}} and again {{input}}")).toEqual(["input"]);
  });

  it("returns empty array for prompt with no handlebars", () => {
    expect(parseHandlebars("No variables here")).toEqual([]);
  });

  describe("when prompt contains malformed tokens", () => {
    it("ignores single-brace tokens", () => {
      expect(parseHandlebars("{only_one_brace}")).toEqual([]);
    });

    it("ignores tokens with spaces inside", () => {
      expect(parseHandlebars("{{spaces inside}}")).toEqual([]);
    });

    it("ignores tokens starting with a digit", () => {
      expect(parseHandlebars("{{1invalid}}")).toEqual([]);
    });

    it("still extracts valid tokens alongside malformed ones", () => {
      expect(parseHandlebars("{{valid}} and {{spaces inside}}")).toEqual([
        "valid",
      ]);
    });
  });
});
