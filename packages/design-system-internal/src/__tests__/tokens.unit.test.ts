import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { tokens } from "../tokens.ts";

const css = readFileSync(resolve(import.meta.dirname, "../styles.css"), "utf8");

const declared = new Map<string, string>(
  Array.from(css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g), (match) => [
    match[1] ?? "",
    (match[2] ?? "").replace(/\s+/g, " ").trim(),
  ]),
);

const scalarGroups = ["font", "text", "space", "radius", "control"] as const;

type ColourName = keyof typeof tokens.light;
const colourNames = Object.keys(tokens.light).filter(
  (name): name is ColourName => name in tokens.dark,
);

describe("tokens", () => {
  describe("given the colour tokens", () => {
    it("declares the same light and dark values as styles.css", () => {
      expect(colourNames).toHaveLength(Object.keys(tokens.light).length);
      const mismatches = colourNames.flatMap((name) => {
        const expected = `light-dark(${tokens.light[name]}, ${tokens.dark[name]})`;
        return declared.get(name) === expected ? [] : [`--${name}: ${declared.get(name)}`];
      });
      expect(mismatches).toEqual([]);
    });
  });

  describe("given a subtree forced with [data-theme]", () => {
    it("declares the tokens on it again, so it resolves its own set", () => {
      expect(css).toMatch(/:root,\s*\[data-theme\]\s*\{\s*--paper:/u);
    });
  });

  describe("given the font, type, space, radius and control tokens", () => {
    it("declares the same value as styles.css", () => {
      const mismatches = scalarGroups.flatMap((group) =>
        Object.entries(tokens[group]).flatMap(([key, value]) =>
          declared.get(`${group}-${key}`) === value ? [] : [`--${group}-${key}`],
        ),
      );
      expect(mismatches).toEqual([]);
    });
  });
});
