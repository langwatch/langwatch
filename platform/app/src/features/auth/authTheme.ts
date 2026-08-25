import { defineConfig } from "@chakra-ui/react";

/**
 * The auth screens's palette, as a real Chakra config rather than a stylesheet
 * of custom properties.
 *
 * It used to be sixteen `--lw-auth-*` properties declared twice in
 * `auth.css` and read back through a `BRAND` object of `var()`
 * strings. That worked, and it cost the screens everything a token system is
 * for: the values were invisible to the theme, untyped at the call site,
 * undiscoverable from any other surface, and a component styling itself wrote
 * `backgroundColor={BRAND.action}` where the rest of the app writes
 * `bg="bg.surface"`. Two vocabularies for one job.
 *
 * Now they are semantic tokens under one namespace, so a component writes
 * `bg="auth.action"` and light/dark resolves the way it does everywhere
 * else in the product.
 *
 * ── Why a namespace rather than overriding the app's own tokens ─────────────
 * The auth screens is the first LangWatch surface most people see, and it should
 * look like the SITE they arrived from rather than like an application they
 * have not signed in to yet. The app's `orange` ramp is a different orange.
 * Reconciling the two everywhere is a theme change this slice has no business
 * making, so the reconciliation stops at this namespace: nothing here changes
 * a single pixel anywhere else in the app.
 *
 * ── Wide gamut ──────────────────────────────────────────────────────────────
 * Every value here is sRGB, and that is deliberate: these are the FALLBACK.
 * `auth.css` re-declares the emitted custom properties inside
 * `@media (color-gamut: p3)` with `color(display-p3 …)` equivalents, so a
 * display that can show the brand orange properly does, and one that cannot
 * never sees a colour it would have to clip. A media query is the only way to
 * express that, and a token cannot hold two values — so the token holds the
 * safe one and the upgrade lives in one clearly-labelled block.
 *
 * Spec: specs/identity/signin-signup-screens.feature
 */

/** The brand ramp, as the marketing site cuts it. */
const brand = {
  /** Lifted for dark grounds, where the solid orange reads as a light source. */
  300: "#ffb380",
  400: "#ff8a3d",
  500: "#f56b1a",
  /** Deepened for white grounds, where white text has to survive on it. */
  600: "#c2510a",
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

export const authThemeConfig = defineConfig({
  theme: {
    semanticTokens: {
      colors: {
        auth: {
          /** The ground the whole viewport stands on: the site's paper, or
           *  the site's dark band — never the app's panel grey. */
          ground: mode("#ffffff", ink[950]),
          /**
           * The primary action, on BOTH grounds. It was an ink pill on paper
           * and orange on ink, which meant the two themes disagreed about
           * what the most important thing on the screen looks like.
           *
           * SOLID on both, and cut from opposite ends of the ramp. The dark
           * value used to be the mid orange at an alpha, which is two
           * mistakes wearing one colour: the alpha let the card's blue glass
           * up through the pill and pulled it toward brown, and the mid cut
           * is the one this file already says a dark ground cannot use — it
           * is why `detail` steps up a stop. The lifted cut is the same
           * decision, made for the button.
           *
           * The direction is the one every other state here takes: darker on
           * paper, brighter on ink, because those are the same direction seen
           * from opposite grounds.
           */
          action: mode(brand[600], brand[400]),
          actionHover: mode(brand[700], brand[300]),
          /**
           * Text that sits on the action colour, and the other half of the
           * fix above. White on the orange it now takes is around 2.4:1,
           * which is not a contrast ratio so much as a rumour of one; ink on
           * it clears 9:1. So the label follows the ground the pill is cut
           * for rather than being white by habit.
           */
          onAction: mode("#ffffff", ink[950]),
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
          focusRing: mode(orange(0.22), orange300(0.22)),
          glow: mode(orange(0.28), orange300(0.22)),
          /**
           * The card is glass on both grounds: a pane over the ground rather
           * than a panel sitting on it.
           *
           * The dark floor sat at 0.42 for a while and the ground's blue
           * bloom shone straight through it: the card's top half took the
           * blue, its bottom half the dark, and the pane read as two
           * surfaces. 0.54 keeps the ground legible through the glass while
           * giving the whole card one continuous floor — see the matching
           * recalibration on `.lw-auth-card`'s backdrop-filter.
           */
          cardBg: mode(white(0.3), "rgba(10, 10, 12, 0.54)"),
          /**
           * On paper the border is a shadow's job done with a line: a soft
           * dark hairline. The white(0.85) it used to be read as a bright
           * ring around the card on a pale ground — an outline, not an edge.
           */
          cardBorder: mode("rgba(20, 20, 23, 0.09)", white(0.1)),
          /** Fields are the same idea, one step down. */
          fieldBg: mode(white(0.62), white(0.06)),
          fieldBorder: mode("rgba(20, 20, 23, 0.14)", white(0.14)),
        },
      },
    },
  },
});

/**
 * The one word of the headline that carries a gradient, and the ground's own
 * atmosphere. Gradients are not colour tokens — Chakra's `colors` namespace
 * holds colours — so they stay custom properties, declared beside the token
 * block in `auth.css` and read by name here.
 */
export const AUTH_GRADIENT = {
  accent: "var(--lw-auth-accent-gradient)",
} as const;

/**
 * The shapes.
 *
 * ── One radius language per card ────────────────────────────────────────
 *
 * `control` is what everything a person operates on the auth card is cut to —
 * the primary button, the method rail, the buttons on the ceremony panel — and
 * it is the SAME radius as `field` on purpose. A card holding 10px inputs
 * under a fully-rounded pill is two shape languages arguing on one surface:
 * the pill reads as a different kind of object from the box above it, when it
 * is the same conversation continuing. Matching them makes the card read as
 * one control surface, which is what the website's own forms do.
 *
 * `action` is the pill, and it stays because the PLANS surfaces
 * (`components/plans/*`) are cut to it and are not this deliverable's to
 * restyle. Nothing on the auth card should reach for it; if the plans pages
 * ever move, this constant goes with them and `control` is the only one left.
 */
export const SHAPE = {
  action: "full",
  control: "10px",
  field: "10px",
  card: "14px",
} as const;

/**
 * Headings on the site are set in Sentient. The font file is not in this
 * repository, so headings land on the serif fallback until it is: a real serif
 * stack, in the same weight and tracking, which reads as the same decision
 * rather than as a missing one.
 */
export const HEADING_FONT =
  '"Sentient", ui-serif, Georgia, "Times New Roman", serif';

/**
 * The mono face the site uses for its small technical lines. The tagline used
 * to be set in it and no longer is — it read as a build log under a sentence
 * whose whole job is to invite — so this is now only the trust strip's label.
 */
export const MONO_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
