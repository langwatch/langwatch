import { defaultConfig, mergeConfigs } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";

import { colorSystem } from "../src/color-mode/color-system.ts";
import { designSystemConfig } from "../src/system/config.ts";
import mainColours from "./main-colours.fixture.json";

type Mode = "_light" | "_dark";
type TokenTree = { [key: string]: TokenTree | string };

const theme = mergeConfigs(defaultConfig, designSystemConfig).theme;
const semantic = theme?.semanticTokens?.colors;
const raw = theme?.tokens?.colors;

function entry(tree: unknown, name: string): unknown {
  let value = tree;
  for (const key of name.split(".")) {
    if (!value || typeof value !== "object") return void 0;
    value = Reflect.get(value, key);
  }
  return value;
}

function resolve(name: string, mode: Mode): string {
  const found = entry(semantic, name) ?? entry(raw, name);
  if (!found || typeof found !== "object") throw new Error(`Unknown colour: ${name}`);
  const leaf = "DEFAULT" in found ? found.DEFAULT : found;
  if (!leaf || typeof leaf !== "object" || !("value" in leaf)) {
    throw new Error(`Missing value: ${name}`);
  }
  const value = leaf.value;
  const reference = typeof value === "string" ? value : entry(value, mode);
  if (typeof reference !== "string") throw new Error(`Missing ${mode}: ${name}`);
  return reference.replace(/\{colors\.([^}]+)\}/g, (_match: string, alias: string) =>
    resolve(alias, mode),
  );
}

function leaves(tree: TokenTree, prefix = ""): [string, unknown][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const name = key === "DEFAULT" ? prefix.slice(0, -1) : `${prefix}${key}`;
    if (typeof value === "string") throw new Error(`Invalid token: ${name}`);
    return "value" in value ? [[name, value.value]] : leaves(value, `${name}.`);
  });
}

function luminance(value: string): number {
  const named: Record<string, string> = { white: "#ffffff", black: "#000000" };
  const hex = named[value] ?? value;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Expected opaque colour: ${hex}`);
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel = Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + weight * linear;
  }, 0);
}

function contrast(a: string, b: string): number {
  const light = luminance(a);
  const dark = luminance(b);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
}

describe("production main colour parity", () => {
  it("preserves all 111 raw scale entries from main", () => {
    expect(colorSystem).toEqual(mainColours.raw);
  });

  it.each(leaves(mainColours.semantic))("preserves main's %s in both modes", (name, expected) => {
    for (const mode of ["_light", "_dark"] satisfies Mode[]) {
      const reference = typeof expected === "string" ? expected : entry(expected, mode);
      if (typeof reference !== "string") throw new Error(`Missing main value: ${name}`);
      const resolved = reference.replace(/\{colors\.([^}]+)\}/g, (_match: string, alias: string) =>
        resolve(alias, mode),
      );
      expect(resolve(name, mode)).toBe(resolved);
    }
  });

  it.each([
    ["bg.card", "bg.panel"],
    ["bg.overlay", "bg.panel"],
    ["bg.raised", "bg.panel"],
    ["bg.nested", "bg.muted"],
    ["bg.control", "bg.input"],
    ["bg.hover", "bg.softHover"],
    ["bg.selected", "nav.bgActive"],
    ["bg.stripe", "bg.subtle"],
    ["nav.marker", "fg.subtle"],
    ["border.card", "border"],
    ["border.control", "border"],
    ["border.nested", "border.muted"],
    ["border.strong", "border.emphasized"],
  ])("maps %s onto main's %s", (alias, target) => {
    for (const mode of ["_light", "_dark"] satisfies Mode[]) {
      expect(resolve(alias, mode)).toBe(resolve(target, mode));
    }
  });
});

describe("main palette contrast", () => {
  it.each(["_light", "_dark"] satisfies Mode[])(
    "keeps primary and secondary text AA in %s",
    (mode) => {
      for (const text of ["fg", "fg.muted"]) {
        for (const ground of [
          "bg.page",
          "bg.surface",
          "bg.panel",
          "bg.muted",
          "bg.input",
          "bg.selected",
        ]) {
          expect(
            contrast(resolve(text, mode), resolve(ground, mode)),
            `${text} on ${ground}`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it("retains main's inverted dark hierarchy", () => {
    expect(resolve("bg.surface", "_dark")).toBe("#080812");
    expect(resolve("bg.page", "_dark")).toBe("#10101a");
    expect(resolve("bg.panel", "_dark")).toBe("#1a1a24");
    expect(luminance(resolve("bg.surface", "_dark"))).toBeLessThan(
      luminance(resolve("bg.page", "_dark")),
    );
    expect(luminance(resolve("bg.page", "_dark"))).toBeLessThan(
      luminance(resolve("bg.panel", "_dark")),
    );
  });
});
