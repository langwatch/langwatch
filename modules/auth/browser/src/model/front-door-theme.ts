import { defineConfig } from "@langwatch/design-system/system";

/** Front-door roles inherit the product palette in both modes. */
export const frontDoorThemeConfig = defineConfig({
  theme: {
    semanticTokens: {
      colors: {
        frontDoor: {
          ground: { value: "{colors.bg.surface}" },
          action: { value: "{colors.orange.solid}" },
          actionHover: { value: "{colors.orange.hover}" },
          onAction: { value: "{colors.orange.contrast}" },
          ink: { value: "{colors.orange.fg}" },
          tint: { value: "{colors.orange.subtle}" },
          hairline: { value: "{colors.border}" },
          danger: { value: "{colors.fg.error}" },
          detail: { value: "{colors.orange.fg}" },
          focusRing: { value: "{colors.accent.focusRing}" },
          glow: { value: "color-mix(in srgb, {colors.orange.fg} 25%, transparent)" },
          fieldBg: { value: "{colors.bg.control}" },
          fieldBorder: { value: "{colors.border.control}" },
          cardBgSolid: { value: "{colors.bg.card}" },
        },
      },
    },
  },
});

/**
 * The one word of the headline with a gradient, and the ground's atmosphere.
 * Gradients aren't colour tokens (Chakra's `colors` namespace holds colours),
 * so they stay custom properties in `authFrontDoor.css`, read by name here.
 */
export const FRONT_DOOR_GRADIENT = {
  accent: "var(--lw-front-door-accent-gradient)",
} as const;

/** One radius language: every control is cut to the field's radius, 14px for the card. */
export const SHAPE = {
  control: "10px",
  field: "10px",
  card: "14px",
} as const;

/**
 * Headings are set in Sentient. Its font file isn't in this repository, so
 * headings land on a real serif fallback (same weight and tracking) until it
 * is — reading as the same decision, not a missing one.
 */
export const HEADING_FONT = '"Sentient", ui-serif, Georgia, "Times New Roman", serif';

/**
 * The mono face the site uses for its small technical lines. The tagline used
 * to be set in it and no longer is — it read as a build log under a sentence
 * whose whole job is to invite — so this is now only the trust strip's label.
 */
export const MONO_FONT = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
