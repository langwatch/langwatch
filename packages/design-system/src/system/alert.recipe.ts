/**
 * Alerts, toasts and banners wear their status as a mesh: soft blobs of the palette's own steps
 * over a flat tint, strongest on alerts. Text keeps the ordinary foreground colours.
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

/** Three soft blobs in three of the palette's steps (solid, emphasized, fg) at `spot` strength. */
const meshImage = (spot: number) =>
  [
    `radial-gradient(70% 140% at 0% 0%, ${step("solid", spot)} 0%, transparent 70%)`,
    `radial-gradient(60% 120% at 100% 100%, ${step("emphasized", Math.round(spot * 0.9))} 0%, transparent 70%)`,
    `radial-gradient(45% 90% at 80% 0%, ${step("fg", Math.round(spot * 0.6))} 0%, transparent 70%)`,
  ].join(", ");

/**
 * How strongly each status surface carries its colour, lightest first: a flat base tint and the
 * mesh blobs over it (light, dark), and the hairline (light, dark). Banners sit quietest, toasts
 * between, alerts strongest, rising outline, subtle, surface.
 */
const MESH = {
  banner: { base: [5, 9], spot: [14, 18], rim: [26, 34] },
  toast: { base: [10, 14], spot: [26, 30], rim: [32, 42] },
  outline: { base: [0, 0], spot: [10, 14], rim: [40, 50] },
  subtle: { base: [14, 20], spot: [32, 38], rim: [38, 50] },
  surface: { base: [22, 28], spot: [44, 50], rim: [48, 60] },
} as const;

export type MeshLevel = keyof typeof MESH;

/** The background, mesh and hairline of a status surface at `level`, in the palette it carries. */
export const statusMesh = (level: MeshLevel) => {
  const { base, spot, rim } = MESH[level];
  const edge = (amount: number) =>
    `color-mix(in srgb, var(--chakra-colors-color-palette-solid) ${amount}%, var(--chakra-colors-border-muted))`;
  return {
    bg: {
      _light: statusTint({ color: "color-palette-solid", ground: "bg-surface", amount: base[0] }),
      _dark: statusTint({ color: "color-palette-solid", ground: "bg-panel", amount: base[1] }),
    },
    backgroundImage: { _light: meshImage(spot[0]), _dark: meshImage(spot[1]) },
    borderColor: { _light: edge(rim[0]), _dark: edge(rim[1]) },
  };
};

/** The mesh at `level` under a shade that deepens with `--index`: a stacked toast's depth. */
export const deepeningMesh = (level: MeshLevel) => {
  const { spot } = MESH[level];
  const shade = "rgba(0, 0, 0, calc(var(--index, 0) * 0.2))";
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
      color: "fg.muted",
    },
  },
  variants: {
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
          backgroundImage: { _light: meshImage(40), _dark: meshImage(34) },
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
});
