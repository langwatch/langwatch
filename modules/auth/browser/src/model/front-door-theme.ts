import { defineConfig } from "@langwatch/design-system/system";

/** Chakra semantic tokens for the front door: site identity separate from app theme. */

/** The brand ramp, as the marketing site cuts it. */
const brand = {
  400: "#ff8a3d",
  500: "#f56b1a",
  700: "#a83e05",
} as const;

const ink = { 900: "#141417", 950: "#0a0a0c" } as const;

/** Dark elevation and hairlines are white at an alpha, never a lighter grey. */
const white = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;
const orange = (alpha: number) => `rgba(245, 107, 26, ${alpha})`;
const orange300 = (alpha: number) => `rgba(255, 138, 61, ${alpha})`;

/** A token with one value per ground. */
const mode = (light: string, dark: string) => ({
  value: { _light: light, _dark: dark },
});

export const frontDoorThemeConfig = defineConfig({
  theme: {
    semanticTokens: {
      colors: {
        frontDoor: {
          /** The ground the whole viewport stands on: the site's paper, or
           *  the site's dark band — never the app's panel grey. */
          ground: mode("#ffffff", ink[950]),
          /** The primary action: the product's own primary button, so door and app agree. */
          action: { value: "{colors.orange.solid}" },
          actionHover: { value: "{colors.orange.hover}" },
          /** Text that sits on the action colour. */
          onAction: { value: "{colors.orange.contrast}" },
          /** Text on a tinted surface: readable where the tint alone is not. */
          ink: mode(brand[700], brand[400]),
          /** The tint itself. */
          tint: mode("#fdece0", orange(0.18)),
          hairline: mode("rgba(20, 20, 23, 0.12)", "rgba(239, 238, 233, 0.14)"),
          /**
           * Refusals. A dark ground needs a lighter red: the light cut fails
           * contrast there and reads as brown, which is not a colour anybody
           * reads as "wrong".
           */
          danger: mode("#c53030", "#e08573"),
          /**
           * Focus rings, badges and hairline accents: the brand without being
           * the button. It steps up a stop on dark, where the solid orange
           * that reads as an action on white disappears into a dark field.
           */
          detail: mode(brand[500], orange300(0.75)),
          /** The product's focus ring, so a focused field reads the same here as in the app. */
          focusRing: { value: "{colors.accent.focusRing}" },
          glow: mode(orange(0.28), orange300(0.22)),
          /** Fields: solid on paper so typed text stays crisp, a faint pane on ink. */
          fieldBg: mode("#ffffff", white(0.05)),
          fieldBorder: mode("rgba(20, 20, 23, 0.16)", white(0.14)),
          /** A near-solid floor for a card that is one sentence with nothing to operate. */
          cardBgSolid: mode(white(0.85), "rgba(12, 12, 15, 0.88)"),
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
