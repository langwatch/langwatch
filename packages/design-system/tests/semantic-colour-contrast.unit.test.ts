import { describe, expect, it } from "vitest";

import { colorSystem } from "../src/color-mode/color-system.ts";
import { designSystemConfig } from "../src/system/config.ts";

type Mode = "_light" | "_dark";

function colour(reference: string): string {
  if (reference === "white") return "#ffffff";
  const name = reference.replace(/[{}]/g, "").replace("colors.", "");
  const [hue, step] = name.split(".");
  const scale = Object.entries(colorSystem).find(([key]) => key === hue)?.[1];
  const value = Object.entries(scale ?? {}).find(([key]) => key === step)?.[1].value;
  if (!value) throw new Error(`Unknown palette reference: ${reference}`);
  return value;
}

function luminance(reference: string): number {
  const hex = colour(reference);
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
    const channel = Number.parseInt(hex.slice(index * 2 + 1, index * 2 + 3), 16) / 255;
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
  const [group, role] = name.split(".");
  const category = Object.entries(colours ?? {}).find(([key]) => key === group)?.[1];
  const entry = Object.entries(category ?? {}).find(([key]) => key === role)?.[1];
  if (!entry || typeof entry !== "object" || !("value" in entry)) {
    throw new Error(`Unknown semantic token: ${name}`);
  }
  const value = entry.value;
  if (!value || typeof value !== "object" || !(mode in value)) {
    throw new Error(`Missing ${mode} for ${name}`);
  }
  const reference = Reflect.get(value, mode);
  if (typeof reference !== "string") throw new Error(`Invalid ${mode} for ${name}`);
  return reference;
}

describe("semantic colour contrast", () => {
  it.each(["_light", "_dark"] satisfies Mode[])("keeps text readable in %s", (mode) => {
    for (const status of ["error", "success", "warning", "info"]) {
      for (const ground of [`bg.${status}`, "bg.panel", "bg.page", "bg.raised"]) {
        expect(contrast(token(`fg.${status}`, mode), token(ground, mode))).toBeGreaterThanOrEqual(
          4.5,
        );
      }
    }
    for (const text of ["fg.muted", "fg.subtle"]) {
      expect(contrast(token(text, mode), token("bg.raised", mode))).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(token("cyan.fg", mode), token("cyan.subtle", mode))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(token("border.strong", mode), token("bg.raised", mode))).toBeGreaterThanOrEqual(
      3,
    );
  });
});
