/**
 * Alerts, toasts and banners wear their status as a mesh: soft blobs of the palette's own steps
 * over a flat tint, strongest on alerts. Text keeps the ordinary foreground colour.
 * {@link dev/docs/best_practices/alerts-toasts-and-field-errors.md}
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/** A faint wash of the status colour over a ground, for a status that reads at a glance. */
export const statusTint = ({
  color,
  ground,
  amount,
}: {
  color: string;
  ground: string;
  amount: number;
}) =>
  `color-mix(in srgb, var(--chakra-colors-${color}) ${amount}%, var(--chakra-colors-${ground}))`;

/** One of the palette's own steps, faded to `amount` percent, for a mesh blob. */
const step = (name: string, amount: number) =>
  `color-mix(in srgb, var(--chakra-colors-color-palette-${name}) ${amount}%, transparent)`;

/** Two broad washes of one hue; no foreground-colour blobs that muddy the corners. */
const meshImage = (spot: number) =>
  [
    `radial-gradient(110% 180% at 0% 0%, ${step("solid", spot)} 0%, transparent 100%)`,
    `radial-gradient(100% 160% at 100% 100%, ${step("solid", Math.round(spot * 0.6))} 0%, transparent 100%)`,
  ].join(", ");

/** Base carries the status; the mesh adds only a small, even variation in that same hue. */
const MESH = {
  banner: { base: [3, 7], spot: [2, 3], rim: [12, 18] },
  toast: { base: [7, 12], spot: [3, 4], rim: [26, 36] },
  outline: { base: [1, 3], spot: [1, 2], rim: [32, 42] },
  subtle: { base: [12, 18], spot: [4, 5], rim: [30, 40] },
  surface: { base: [18, 22], spot: [5, 6], rim: [38, 48] },
} as const;

export type MeshLevel = keyof typeof MESH;

/** The background, mesh and hairline of a status surface at `level`, in the palette it carries. */
export const statusMesh = (level: MeshLevel) => {
  const { base, spot, rim } = MESH[level];
  const edge = (amount: number) =>
    `color-mix(in srgb, var(--chakra-colors-color-palette-solid) ${amount}%, var(--chakra-colors-border-muted))`;
  const image = (amount: number) =>
    level === "banner"
      ? [
          `radial-gradient(32rem 12rem at 0% 0%, ${step("solid", amount)} 0%, transparent 100%)`,
          `radial-gradient(24rem 10rem at 85% 100%, ${step("solid", Math.round(amount * 0.6))} 0%, transparent 100%)`,
        ].join(", ")
      : meshImage(amount);
  return {
    bg: {
      _light: statusTint({ color: "color-palette-solid", ground: "bg-card", amount: base[0] }),
      _dark: statusTint({ color: "color-palette-solid", ground: "bg-card", amount: base[1] }),
    },
    backgroundImage: { _light: image(spot[0]), _dark: image(spot[1]) },
    borderColor: { _light: edge(rim[0]), _dark: edge(rim[1]) },
  };
};

/** The mesh at `level` under a shade that deepens with `--index`: a stacked toast's depth. */
export const deepeningMesh = (level: MeshLevel) => {
  const { spot } = MESH[level];
  const shade = "rgba(0, 0, 0, clamp(0, calc(var(--index, 0) * 0.08), 0.24))";
  const under = `linear-gradient(${shade}, ${shade})`;
  return { _light: `${under}, ${meshImage(spot[0])}`, _dark: `${under}, ${meshImage(spot[1])}` };
};

export const alertSlotRecipe = defineSlotRecipe({
  slots: ["root", "indicator", "content", "title", "description"],
  base: {
    root: {
      borderRadius: "xl",
      borderWidth: "1px",
      borderColor: "transparent",
      color: "fg",
    },
    indicator: {
      width: "var(--alert-indicator-size)",
      height: "var(--alert-line-height)",
      color: "colorPalette.fg",
      _icon: { boxSize: "var(--alert-indicator-size)" },
    },
    content: {
      gap: "0.5",
      minWidth: "0",
    },
    title: {
      fontWeight: "medium",
    },
    description: {
      color: "inherit",
    },
  },
  variants: {
    status: {
      neutral: {
        root: {
          // A neutral wash must separate from the brighter card ground too.
          "--chakra-colors-color-palette-solid": {
            _light: "{colors.fg.subtle}",
            _dark: "{colors.border.control}",
          },
        },
      },
    },
    variant: {
      outline: {
        root: { ...statusMesh("outline"), color: "fg", shadow: "none" },
      },
      subtle: {
        root: { ...statusMesh("subtle"), color: "fg" },
      },
      surface: {
        root: { ...statusMesh("surface"), color: "fg", shadow: "xs" },
      },
      // Chakra's own fill fails AA for white on orange and red; this one
      // passes in both modes.
      solid: {
        root: {
          bg: { _light: "colorPalette.fg", _dark: "colorPalette.muted" },
          backgroundImage: { _light: meshImage(4), _dark: meshImage(8) },
          borderColor: "transparent",
          color: { _light: "fg.inverted", _dark: "fg" },
        },
        indicator: { color: "inherit" },
        description: { color: "inherit" },
      },
    },
    size: {
      sm: {
        root: {
          "--alert-indicator-size": "sizes.3",
          "--alert-line-height": "sizes.4",
          borderRadius: "lg",
          gap: "2",
          px: "2.5",
          py: "1.5",
          textStyle: "xs",
        },
        content: { gap: "0" },
      },
      md: {
        root: {
          "--alert-indicator-size": "sizes.4",
          "--alert-line-height": "sizes.5",
          gap: "2.5",
          px: "3.5",
          py: "3",
          textStyle: "sm",
        },
      },
      lg: {
        root: {
          "--alert-indicator-size": "sizes.5",
          "--alert-line-height": "sizes.6",
          gap: "3",
          px: "4",
          py: "3.5",
          textStyle: "md",
        },
      },
    },
  },
  compoundVariants: [
    {
      status: "neutral",
      variant: "solid",
      css: { root: { bg: { _dark: "bg.control" }, color: { _dark: "fg" } } },
    },
  ],
});
