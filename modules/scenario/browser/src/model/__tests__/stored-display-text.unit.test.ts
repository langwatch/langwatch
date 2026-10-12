import { describe, expect, it } from "vitest";

import { storedDisplayText } from "../stored-display-text.ts";

describe("storedDisplayText()", () => {
  it("reads the text parts of a content array stored as JSON", () => {
    const stored = JSON.stringify([
      { type: "text", text: "Hello " },
      { type: "input_audio", input_audio: { data: "x" } },
      { type: "text", text: "there" },
    ]);

    expect(storedDisplayText(stored)).toBe("Hello there");
  });

  it("trims plain stored text", () => {
    expect(storedDisplayText("  Hello  ")).toBe("Hello");
  });

  it("keeps bracketed text that is not JSON", () => {
    expect(storedDisplayText("[draft] Hello")).toBe("[draft] Hello");
  });

  it("reads an empty START row as no text", () => {
    expect(storedDisplayText(undefined)).toBe("");
  });
});
