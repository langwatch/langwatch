/**
 * Alerts wear the card material, faintly tinted, with the status in the
 * hairline and the icon and the text in the ordinary foreground colours.
 * {@link dev/docs/best_practices/alerts-toasts-and-field-errors.md}
 */

import { defineSlotRecipe } from "@chakra-ui/react";

/**
 * A restrained hairline in the status colour, mixed into the neutral border
 * rather than drawn on top — same formula as the Langy card's `accentBorder`
 * (`features/asaplangy/tokens.ts`), for a tone without a coloured ring.
 */
export const statusHairline = (color: string) =>
  `color-mix(in srgb, var(--chakra-colors-${color}) 26%, var(--chakra-colors-border-muted))`;

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

/** The status colour of whichever palette the root carries, as a hairline. */
const paletteHairline = statusHairline("color-palette-solid");

/** Enough of the status colour that a warning reads orange, in either mode. */
const paletteTint = {
  _light: statusTint({ color: "color-palette-solid", ground: "bg-surface", amount: 12 }),
  _dark: statusTint({ color: "color-palette-solid", ground: "bg-panel", amount: 16 }),
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
      subtle: {
        root: {
          bg: paletteTint,
          color: "fg",
          borderColor: paletteHairline,
        },
      },
      surface: {
        root: {
          bg: { _light: "bg.surface", _dark: "bg.panel" },
          color: "fg",
          shadow: "xs",
          borderColor: "border.muted",
          borderInlineStartWidth: "3px",
          borderInlineStartColor: "colorPalette.solid",
        },
      },
      outline: {
        root: {
          bg: "transparent",
          color: "fg",
          shadow: "none",
          borderColor: paletteHairline,
        },
      },
      // Chakra's own fill fails AA for white on orange and red; this one
      // passes in both modes.
      solid: {
        root: {
          bg: { _light: "colorPalette.fg", _dark: "colorPalette.muted" },
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
