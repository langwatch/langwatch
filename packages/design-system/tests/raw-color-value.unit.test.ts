/**
 * @vitest-environment jsdom
 * `getRawColorValue` hands a literal to code that cannot take a token.
 */
import { afterEach, describe, expect, it } from "vitest";

import { expandCssVars, getRawColorValue } from "../src/color-mode/index.tsx";

const light: Record<string, string> = {
  "--chakra-colors-fg-muted": "var(--chakra-colors-gray-600)",
  "--chakra-colors-gray-600": "#3d3d4d",
};
const dark: Record<string, string> = {
  "--chakra-colors-fg-muted": "var(--chakra-colors-gray-300)",
  "--chakra-colors-gray-300": "#cbd5e1",
};

describe("expandCssVars", () => {
  it("resolves a semantic variable to the literal for the mode it reads from", () => {
    const value = "var(--chakra-colors-fg-muted)";
    expect(expandCssVars({ value, read: (name) => light[name] ?? "" })).toBe("#3d3d4d");
    expect(expandCssVars({ value, read: (name) => dark[name] ?? "" })).toBe("#cbd5e1");
  });

  it("throws on a variable that is not defined", () => {
    expect(() => expandCssVars({ value: "var(--missing)", read: () => "" })).toThrow(
      "--missing is not defined",
    );
  });

  it("throws on a variable that refers to itself", () => {
    expect(() => expandCssVars({ value: "var(--loop)", read: () => "var(--loop)" })).toThrow(
      "deeper than",
    );
  });
});

describe("getRawColorValue", () => {
  afterEach(() => {
    document.head.querySelectorAll("style[data-test]").forEach((node) => node.remove());
  });

  it("returns a scale step from the palette without a stylesheet", () => {
    expect(getRawColorValue("gray.400")).toBe("#9CA3AF");
  });

  it("throws for a token the stylesheet does not define instead of guessing", () => {
    expect(() => getRawColorValue("blue.fg")).toThrow();
    expect(() => getRawColorValue("not-a-colour")).toThrow();
  });

  it("reads a semantic token from the stylesheet Chakra emits", () => {
    const sheet = document.createElement("style");
    sheet.dataset.test = "tokens";
    sheet.textContent =
      "body { --chakra-colors-blue-fg: var(--chakra-colors-blue-700); --chakra-colors-blue-700: #2c5282; }";
    document.head.append(sheet);

    expect(getRawColorValue("blue.fg")).toBe("#2c5282");
  });
});
