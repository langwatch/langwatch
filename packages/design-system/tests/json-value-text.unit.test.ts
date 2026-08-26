import { describe, expect, it } from "vitest";

import {
  displayOptionalValue,
  displayValue,
  serializeOptionalScalarValue,
  serializeScalarValue,
} from "../src/json-value-text";

describe("JSON value text", () => {
  it("renders values without text as an empty controlled input", () => {
    expect(displayValue(void 0)).toBe("");
    expect(displayValue(() => null)).toBe("");
    expect(displayValue(Symbol("s"))).toBe("");
  });

  it("quotes strings that would otherwise change type", () => {
    expect(displayValue("7")).toBe('"7"');
    expect(displayValue("true")).toBe('"true"');
    expect(displayValue("007")).toBe("007");
    expect(displayValue("eu-central")).toBe("eu-central");
  });

  it("parses scalar JSON and preserves non-scalar JSON as text", () => {
    expect(serializeScalarValue("12")).toBe(12);
    expect(serializeScalarValue("true")).toBe(true);
    expect(serializeScalarValue('"007"')).toBe("007");
    expect(serializeScalarValue("{}")).toBe("{}");
    expect(serializeScalarValue("[1,2]")).toBe("[1,2]");
    expect(serializeScalarValue("null")).toBe("null");
  });

  it("round-trips optional scalar text and keeps an empty field absent", () => {
    expect(serializeOptionalScalarValue("")).toBeUndefined();
    expect(displayOptionalValue(void 0)).toBe("");

    for (const text of ["eu-central", "007", "12", "true", '"7"']) {
      expect(displayOptionalValue(serializeOptionalScalarValue(text))).toBe(text);
    }
  });
});
