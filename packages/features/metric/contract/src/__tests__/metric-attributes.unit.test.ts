import { describe, expect, it } from "vitest";
import { scalarsFromCanonicalAttributes } from "../index";

describe("scalarsFromCanonicalAttributes", () => {
  it("lifts canonical scalar values and ignores structured or malformed entries", () => {
    const scalars = scalarsFromCanonicalAttributes([
      { key: "string", value: { type: "string", value: "value" } },
      { key: "integer", value: { type: "int", value: "9007199254740993" } },
      { key: "boolean", value: { type: "bool", value: true } },
      { key: "double", value: { type: "double", value: 1.5 } },
      { key: "array", value: { type: "array", value: [] } },
      { key: "wrong", value: { type: "double", value: "1.5" } },
      null,
    ]);

    expect(scalars).toEqual({
      string: "value",
      integer: "9007199254740993",
      boolean: true,
      double: 1.5,
    });
  });

  it("returns no values for a non-array boundary value", () => {
    expect(scalarsFromCanonicalAttributes({ attributes: [] })).toEqual({});
  });
});
