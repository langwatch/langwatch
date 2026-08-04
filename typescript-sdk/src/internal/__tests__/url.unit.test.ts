import { describe, it, expect } from "vitest";
import { trimTrailingSlashes } from "../url";

/**
 * The helper replaced a `/\/+$/` regex that CodeQL flagged as a polynomial
 * backtracking hazard, so the contract these tests pin is equivalence: for
 * every input, the loop must return exactly what the regex returned.
 */
const withRegex = (input: string): string => input.replace(/\/+$/, "");

describe("trimTrailingSlashes", () => {
  const cases: { name: string; input: string; expected: string }[] = [
    { name: "empty string", input: "", expected: "" },
    {
      name: "no trailing slash",
      input: "https://app.langwatch.ai",
      expected: "https://app.langwatch.ai",
    },
    {
      name: "one trailing slash",
      input: "https://app.langwatch.ai/",
      expected: "https://app.langwatch.ai",
    },
    {
      name: "many trailing slashes",
      input: "https://app.langwatch.ai/////",
      expected: "https://app.langwatch.ai",
    },
    { name: "slash-only string", input: "////", expected: "" },
    {
      name: "protocol-relative URL keeps its leading slashes",
      input: "//app.langwatch.ai",
      expected: "//app.langwatch.ai",
    },
    {
      name: "protocol-relative URL with a trailing slash",
      input: "//app.langwatch.ai/",
      expected: "//app.langwatch.ai",
    },
    {
      name: "interior slashes are untouched",
      input: "https://app.langwatch.ai/api/v1//",
      expected: "https://app.langwatch.ai/api/v1",
    },
    { name: "a lone slash", input: "/", expected: "" },
  ];

  for (const { name, input, expected } of cases) {
    it(`handles ${name}`, () => {
      expect(trimTrailingSlashes(input)).toBe(expected);
      expect(trimTrailingSlashes(input)).toBe(withRegex(input));
    });
  }

  it("returns the same string instance when there is nothing to trim", () => {
    const input = "https://app.langwatch.ai";
    expect(trimTrailingSlashes(input)).toBe(input);
  });

  it("stays linear on a long run of slashes", () => {
    const input = `https://app.langwatch.ai${"/".repeat(50_000)}`;
    const started = performance.now();
    expect(trimTrailingSlashes(input)).toBe("https://app.langwatch.ai");
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
