import { describe, expect, it } from "vitest";

import { colorSystem } from "../src/color-mode/color-system.ts";
import { designSystemConfig } from "../src/system/config.ts";

type Mode = "_light" | "_dark";

function colour(reference: string): number[] {
  if (reference === "white") return [255, 255, 255];
  if (/^#[0-9a-f]{6}$/i.test(reference))
    return [0, 2, 4].map((index) => Number.parseInt(reference.slice(index + 1, index + 3), 16));
  const mix = /^color-mix\(in srgb, (\{colors\.[^}]+\}) (\d+)%, (\{colors\.[^}]+\})\)$/.exec(
    reference,
  );
  if (mix?.[1] && mix[2] && mix[3]) {
    const share = Number(mix[2]) / 100;
    const other = colour(mix[3]);
    return colour(mix[1]).map(
      (channel, index) => channel * share + (other[index] ?? 0) * (1 - share),
    );
  }
  const name = reference.replace(/[{}]/g, "").replace("colors.", "");
  const [hue, step] = name.split(".");
  const scale = Object.entries(colorSystem).find(([key]) => key === hue)?.[1];
  const value = Object.entries(scale ?? {}).find(([key]) => key === step)?.[1].value;
  if (!value) throw new Error(`Unknown palette reference: ${reference}`);
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index + 1, index + 3), 16));
}

function luminance(reference: string): number {
  const channels = colour(reference);
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel = (channels[index] ?? 0) / 255;
    const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    return sum + weight * linear;
  }, 0);
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const colours = designSystemConfig.theme?.semanticTokens?.colors;

function token(name: string, mode: Mode): string {
  const [group, role = "DEFAULT"] = name.split(".");
  const category = Object.entries(colours ?? {}).find(([key]) => key === group)?.[1];
  const entry = Object.entries(category ?? {}).find(([key]) => key === role)?.[1];
  if (!entry || typeof entry !== "object" || !("value" in entry)) {
    throw new Error(`Unknown semantic token: ${name}`);
  }
  const value = entry.value;
  let reference: unknown = value;
  if (value && typeof value === "object") reference = Reflect.get(value, mode);
  if (typeof reference !== "string") throw new Error(`Invalid ${mode} for ${name}`);
  const alias = /^\{colors\.([^}]+)\}$/.exec(reference);
  if (!alias?.[1]) return reference;
  const [aliasGroup, aliasRole = "DEFAULT"] = alias[1].split(".");
  const semanticGroup = Object.entries(colours ?? {}).find(([key]) => key === aliasGroup)?.[1];
  return Object.keys(semanticGroup ?? {}).includes(aliasRole) ? token(alias[1], mode) : reference;
}

describe("semantic colour contrast", () => {
  it.each(["_light", "_dark"] satisfies Mode[])("keeps text readable in %s", (mode) => {
    for (const status of ["error", "success", "warning", "info"]) {
      for (const ground of [
        `bg.${status}`,
        "bg.page",
        "bg",
        "bg.panel",
        "bg.muted",
        "bg.emphasized",
      ]) {
        expect(contrast(token(`fg.${status}`, mode), token(ground, mode))).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
    for (const text of ["fg", "fg.muted", "fg.subtle"]) {
      for (const ground of ["bg.page", "bg", "bg.panel", "bg.muted", "bg.emphasized"]) {
        expect(
          contrast(token(text, mode), token(ground, mode)),
          `${text} on ${ground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(contrast(token("cyan.fg", mode), token("cyan.subtle", mode))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(token("border.strong", mode), token("bg.raised", mode))).toBeGreaterThanOrEqual(
      3,
    );
  });
});

function lightness(reference: string): number {
  const y = luminance(reference);
  return y > (6 / 29) ** 3 ? 116 * Math.cbrt(y) - 16 : (29 / 3) ** 3 * y;
}

describe("nested surface separation", () => {
  it("keeps Primer's four grounds close, ordered, and separated by hairlines", () => {
    const levels = ["bg.page", "bg", "bg.panel", "bg.emphasized"];
    const expected = ["#010409", "#0d1117", "#151b23", "#212830"];
    levels.forEach((name, index) => expect(token(name, "_dark")).toBe(expected[index]));
    const gaps = levels
      .slice(1)
      .map(
        (name, index) =>
          lightness(token(name, "_dark")) - lightness(token(levels[index]!, "_dark")),
      );
    // Primer deliberately uses small luminance steps; structural borders carry separation.
    // An 8 L* minimum forced lighter, washed-out cards and extra apparent materials.
    for (const gap of gaps) {
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThan(8);
    }
    expect(token("bg.muted", "_dark")).toBe(token("bg.emphasized", "_dark"));
  });

  it.each(["_light", "_dark"] satisfies Mode[])(
    "separates edges from their parent in %s",
    (mode) => {
      for (const [edge, parent] of [
        ["card", "page"],
        ["nested", "card"],
        ["control", "nested"],
      ]) {
        expect(
          contrast(token(`border.${edge}`, mode), token(`bg.${parent}`, mode)),
        ).toBeGreaterThanOrEqual(1.2);
      }
      for (const ground of ["bg.nested", "bg.control"]) {
        expect(
          contrast(token("border.emphasized", mode), token(ground, mode)),
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("keeps light neighbouring grounds distinct", () => {
    for (const [a, b] of [
      ["page", "card"],
      ["card", "nested"],
      ["nested", "control"],
    ]) {
      expect(
        Math.abs(luminance(token(`bg.${a}`, "_light")) - luminance(token(`bg.${b}`, "_light"))),
      ).toBeGreaterThanOrEqual(0.08);
    }
  });
});
