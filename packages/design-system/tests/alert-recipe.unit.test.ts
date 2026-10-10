import type { SystemStyleObject } from "@chakra-ui/react";
import { describe, expect, it } from "vitest";

import { statusMesh } from "../src/system/alert.recipe.ts";
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

const MIX = /^color-mix\(in srgb, (var\([^)]+\)) (\d+)%, (var\([^)]+\))\)$/;

/** Follows `var()` references, and mixes `color-mix` in sRGB, down to one flat colour. */
function resolve({ value, mode, root }: { value: string; mode: Mode; root: Declarations }): string {
  const mix = MIX.exec(value.trim());
  if (mix?.[1] && mix[2] && mix[3]) {
    const share = Number(mix[2]) / 100;
    const into = channels(resolve({ value: mix[3], mode, root }));
    const mixed = channels(resolve({ value: mix[1], mode, root })).map((channel, at) =>
      Math.round(channel * share + (into[at] ?? 0) * (1 - share)),
    );
    return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
  }
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

/** Bound every pixel, including overlapping blob peaks, rather than just the flat base. */
function meshGrounds({ root, ground, mode }: { root: Declarations; ground: string; mode: Mode }) {
  const stops = [
    ...(root.backgroundImage ?? "").matchAll(
      /color-mix\(in srgb, (var\([^)]+\)) (\d+)%, transparent\)/g,
    ),
  ];
  expect(stops).toHaveLength((root.backgroundImage?.match(/radial-gradient/g) ?? []).length);
  return stops.reduce<string[]>(
    (grounds, stop) => {
      const colour = channels(resolve({ value: stop[1] ?? "", mode, root }));
      const share = Number(stop[2]) / 100;
      return grounds.flatMap((base) => [
        base,
        `#${channels(base)
          .map((channel, at) =>
            Math.round(channel * (1 - share) + (colour[at] ?? 0) * share)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`,
      ]);
    },
    [ground],
  );
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
  const ground = own === "transparent" ? read("var(--chakra-colors-bg-card)") : own;
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
    it("tints the card in both modes", () => {
      const light = paint({ status: "error", variant: "subtle", mode: "light" });
      const dark = paint({ status: "error", variant: "subtle", mode: "dark" });

      expect(light.root.background).toContain("var(--chakra-colors-bg-card)");
      expect(dark.root.background).toContain("var(--chakra-colors-bg-card)");
      expect(light.ground).not.toBe(dark.ground);
    });

    /** @scenario "A status tints its alert in either colour mode" */
    it.each(["light", "dark"] as const)("gives every status its own tint in %s", (mode) => {
      const plain = resolve({
        value: "var(--chakra-colors-bg-card)",
        mode,
        root: {},
      });
      const tints = STATUSES.filter((status) => status !== "neutral").map(
        (status) => paint({ status, variant: "subtle", mode }).ground,
      );

      expect(new Set(tints).size).toBe(tints.length);
      for (const tint of tints) expect(tint).not.toBe(plain);
    });

    /** @scenario "A status tints its alert in either colour mode" */
    it.each(["light", "dark"] as const)("reads a warning as orange in %s", (mode) => {
      const [red = 0, green = 0, blue = 0] = channels(
        paint({ status: "warning", variant: "subtle", mode }).ground,
      );

      expect(red).toBeGreaterThan(green);
      expect(green).toBeGreaterThan(blue);
      expect(red - blue).toBeGreaterThanOrEqual(20);
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

      for (const ground of meshGrounds({ ...painted, mode })) {
        expect(contrast({ a: painted.title, b: ground })).toBeGreaterThanOrEqual(4.5);
        expect(contrast({ a: painted.description, b: ground })).toBeGreaterThanOrEqual(4.5);
        expect(contrast({ a: painted.indicator, b: ground })).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe("given the quieter status surfaces", () => {
    /** @scenario "Status meshes keep their hierarchy and contrast" */
    it.each(["light", "dark"] as const)("keeps banners and toasts readable in %s", (mode) => {
      for (const status of STATUSES) {
        const painted = paint({ status, variant: "subtle", mode });
        for (const level of ["banner", "toast"] as const) {
          const surface = slotIn({
            styles: system.sva({ slots: ["root"], base: { root: statusMesh(level) } })({}).root,
            mode,
          });
          const root = { ...painted.root, ...surface };
          const ground = resolve({ value: root.background ?? "", mode, root });
          for (const background of meshGrounds({ root, ground, mode })) {
            expect(contrast({ a: painted.title, b: background })).toBeGreaterThanOrEqual(4.5);
            expect(contrast({ a: painted.indicator, b: background })).toBeGreaterThanOrEqual(3);
          }
        }
      }
    });
  });

  describe("given the status strength hierarchy", () => {
    it("uses main's sunken input ground for a dark neutral solid", () => {
      const solid = paint({ status: "neutral", variant: "solid", mode: "dark" });
      expect(solid.ground).toBe("#10101a");
      expect(solid.ground).toBe(
        resolve({ value: "var(--chakra-colors-bg-input)", mode: "dark", root: solid.root }),
      );
    });

    /** @scenario "Status meshes keep their hierarchy and contrast" */
    it.each(["light", "dark"] as const)("orders the painted colour strength in %s", (mode) => {
      for (const status of STATUSES) {
        const painted = paint({ status, variant: "subtle", mode });
        const plain = channels(
          resolve({
            value: "var(--chakra-colors-bg-card)",
            mode,
            root: painted.root,
          }),
        );
        const strength = (ground: string) =>
          channels(ground).reduce(
            (sum, channel, at) => sum + Math.abs(channel - (plain[at] ?? 0)),
            0,
          );
        let previousMinimum = -1;
        let previousMaximum = -1;
        // Main’s input ground is sunken; the neutral solid is not a stronger status tint.
        const levels = ["outline", "banner", "toast", "subtle", "surface", "solid"] as const;
        const orderedLevels = levels.filter(
          (level) => !(status === "neutral" && mode === "dark" && level === "solid"),
        );
        for (const level of orderedLevels) {
          const surface =
            level === "solid"
              ? paint({ status, variant: "solid", mode })
              : (() => {
                  const styles = slotIn({
                    styles: system.sva({ slots: ["root"], base: { root: statusMesh(level) } })({})
                      .root,
                    mode,
                  });
                  const root = { ...painted.root, ...styles };
                  return { root, ground: resolve({ value: root.background ?? "", mode, root }) };
                })();
          const bounds = meshGrounds({ ...surface, mode }).map(strength);
          expect(Math.min(...bounds), `${status} ${level} base`).toBeGreaterThan(previousMinimum);
          expect(Math.max(...bounds), `${status} ${level} peaks`).toBeGreaterThan(previousMaximum);
          previousMinimum = Math.min(...bounds);
          previousMaximum = Math.max(...bounds);
        }
      }
    });
  });

  describe("given the compact size", () => {
    /** @scenario "A small alert is compact" */
    it("sets smaller padding, text and icon than the default", () => {
      const small = slotIn({ styles: alert({ size: "sm" }).root, mode: "light" });
      const medium = slotIn({ styles: alert({ size: "md" }).root, mode: "light" });

      expect(small.paddingBlock).toBe("var(--chakra-spacing-1\\.5)");
      expect(medium.paddingBlock).toBe("var(--chakra-spacing-3)");
      expect(small.fontSize).toBe("var(--chakra-font-sizes-xs)");
      expect(medium.fontSize).toBe("var(--chakra-font-sizes-sm)");
      expect(small["--alert-indicator-size"]).toBe("var(--chakra-sizes-3)");
      expect(medium["--alert-indicator-size"]).toBe("var(--chakra-sizes-4)");
      expect(small["--alert-line-height"]).toBe("var(--chakra-sizes-4)");
    });
  });
});
