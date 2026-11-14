import { describe, expect, it } from "vitest";

import { developerSeatsProblem } from "../license-terms.ts";

describe("developerSeatsProblem", () => {
  it.each(["", "0", "4", "2147483647"])("accepts %j", (typed) => {
    expect(developerSeatsProblem(typed)).toBeUndefined();
  });

  it.each(["-1", "1.5", "abc"])("refuses %j as not a whole number", (typed) => {
    expect(developerSeatsProblem(typed)).toBe(
      "Enter a whole number of Developer seats, 0 or more.",
    );
  });

  it("names the seat column's maximum above it", () => {
    expect(developerSeatsProblem("2147483648")).toContain("at most 2147483647");
  });
});
