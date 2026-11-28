import { describe, expect, it } from "vitest";

import { withArticle } from "../index.ts";

describe("withArticle()", () => {
  it("puts an before a vowel", () => {
    expect(withArticle("Admin")).toBe("an Admin");
  });

  it("puts a before a consonant", () => {
    expect(withArticle("Lite Member")).toBe("a Lite Member");
  });
});
