import type { SystemStyleObject } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";

import { system } from "../src/system/index.ts";

type Mode = "light" | "dark";
type Declarations = Record<string, string>;

const STATUSES = ["info", "success", "warning", "error", "neutral"] as const;
const VARIANTS = ["subtle", "surface", "outline", "solid"] as const;
const MODE_SELECTOR: Record<Mode, string> = {
  light: ":root &, .light &",
  dark: ".dark &, .dark .chakra-theme:not(.light) &",
};

function fields(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function declarations(value: unknown): Declarations {
  return Object.fromEntries(
    Object.entries(fields(value)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

const tokenLayer = fields(fields(system.getTokenCss())["@layer tokens"]);
const foundations = declarations(tokenLayer["&:where(html, .chakra-theme)"]);
const modeTokens = (mode: Mode) => declarations(tokenLayer[MODE_SELECTOR[mode]]);

const alert = system.sva(system.getSlotRecipe("alert"));

function isStyleObject(value: unknown): value is SystemStyleObject {
  return typeof value === "object" && value !== null;
}

/** One slot's declarations as a colour mode sees them, conditions flattened. */
function slotIn({ styles, mode }: { styles: unknown; mode: Mode }): Declarations {
  if (!isStyleObject(styles)) throw new Error("the recipe returned no style object");
  const layered = fields(fields(system.css(styles))["@layer recipes"]);
  return { ...declarations(layered), ...declarations(layered[MODE_SELECTOR[mode]]) };
}

/** Follows `var()` references through the root's own and the theme's variables. */
function resolve({ value, mode, root }: { value: string; mode: Mode; root: Declarations }): string {
  const reference = /^var\((--[^,)]+)\)$/.exec(value.trim());
  if (!reference?.[1]) return value.trim();
  const name = reference[1];
  const next = root[name] ?? modeTokens(mode)[name] ?? foundations[name];
  if (next === undefined) throw new Error(`unresolved ${name} in ${mode}`);
  return resolve({ value: next, mode, root });
}

function channels(colour: string): number[] {
  if (colour === "white") return [255, 255, 255];
  const hex = /^#([0-9a-f]{6})$/i.exec(colour)?.[1];
  if (!hex) throw new Error(`not a flat colour: ${colour}`);
  return [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

function luminance(colour: string): number {
  const [r, g, b] = channels(colour).map((channel) => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast({ a, b }: { a: string; b: string }): number {
  const [light, dark] = [luminance(a), luminance(b)].toSorted((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** The colours one alert paints in one mode; an outline alert sits on the surface. */
function paint({
  status,
  variant,
  mode,
}: {
  status: (typeof STATUSES)[number];
  variant: (typeof VARIANTS)[number];
  mode: Mode;
}) {
  const slots = alert({ status, variant, size: "md" });
  const root = slotIn({ styles: slots.root, mode });
  const read = (value: string | undefined) => resolve({ value: value ?? "", mode, root });
  const description = slotIn({ styles: slots.description, mode }).color;
  const indicator = slotIn({ styles: slots.indicator, mode }).color;
  const text = read(root.color);
  const own = read(root.background);
  const ground =
    own === "transparent"
      ? read(mode === "light" ? "var(--chakra-colors-bg-surface)" : "var(--chakra-colors-bg-panel)")
      : own;
  return {
    root,
    ground,
    title: text,
    description: description === "inherit" ? text : read(description),
    indicator: indicator === "inherit" ? text : read(indicator),
  };
}

describe("the alert recipe", () => {
  describe("given an alert with the default variant", () => {
    /** @scenario "An alert wears the card material in either colour mode" */
    it("grounds on the surface in light and on the panel in dark", () => {
      const light = paint({ status: "error", variant: "subtle", mode: "light" });
      const dark = paint({ status: "error", variant: "subtle", mode: "dark" });

      expect(light.root.background).toBe("var(--chakra-colors-bg-surface)");
      expect(dark.root.background).toBe("var(--chakra-colors-bg-panel)");
      expect(light.ground).not.toBe(dark.ground);
    });

    /** @scenario "An alert wears the card material in either colour mode" */
    it("carries the status in the hairline and the icon rather than the text", () => {
      const light = paint({ status: "error", variant: "subtle", mode: "light" });
      const dark = paint({ status: "error", variant: "subtle", mode: "dark" });

      expect(light.root.borderColor).toContain("var(--chakra-colors-color-palette-solid)");
      expect(light.indicator).toBe(
        resolve({ value: "var(--chakra-colors-red-fg)", mode: "light", root: {} }),
      );
      expect(dark.indicator).toBe(
        resolve({ value: "var(--chakra-colors-red-fg)", mode: "dark", root: {} }),
      );
      expect(light.indicator).not.toBe(dark.indicator);
      expect(light.title).toBe(
        resolve({ value: "var(--chakra-colors-fg)", mode: "light", root: {} }),
      );
    });
  });

  describe("given every status in every variant", () => {
    const cases = (["light", "dark"] as const).flatMap((mode) =>
      VARIANTS.flatMap((variant) => STATUSES.map((status) => ({ mode, variant, status }))),
    );

    /** @scenario "Every alert keeps its text readable in both colour modes" */
    it.each(cases)("reads at AA for $status $variant in $mode", ({ mode, variant, status }) => {
      const painted = paint({ status, variant, mode });

      expect(contrast({ a: painted.title, b: painted.ground })).toBeGreaterThanOrEqual(4.5);
      expect(contrast({ a: painted.description, b: painted.ground })).toBeGreaterThanOrEqual(4.5);
      expect(contrast({ a: painted.indicator, b: painted.ground })).toBeGreaterThanOrEqual(3);
    });
  });
});
