import { defineConfig } from "@chakra-ui/react";

/**
 * Langy's colour theme — a real Chakra config, not overrides. Two
 * conditions (`_langy`, `_langyDark`) attach Langy's palette to the
 * app's own tokens. See `specs/langy/langy-panel-theme.feature`.
 */

const ink = {
  900: "#141417",
  950: "#0a0a0c",
} as const;

/** The brand ramp. `300` is THE accent on dark; `400` carries white text. */
const brand = {
  300: "#ffb380",
  400: "#ff8a3d",
  500: "#f56b1a",
} as const;

/** Dark elevation and hairlines are white at an alpha — never a lighter grey. */
const white = (alpha: number) => `rgba(255, 255, 255, ${alpha})`;
/** The dark accent is brand-300 at an alpha, exactly as the site uses it. */
const brand300 = (alpha: number) => `rgba(255, 179, 128, ${alpha})`;

/** A token that only exists on Langy's dark ground; light inherits the app. */
const langyDark = (dark: string) => ({
  value: { _langyDark: dark },
});

/** The tokens with no app fallback carry a value on BOTH grounds. */
const langy = (light: string, dark: string) => ({
  value: { _langy: light, _langyDark: dark },
});

export const langyThemeConfig = defineConfig({
  conditions: {
    langy: ".langy-root &",
    langyDark: ".dark .langy-root &",
  },
  theme: {
    semanticTokens: {
      colors: {
        // ── Surfaces (dark only, light is the app's own) ───────────────────
        // Dark is an ink ground with white-alpha layers stacked on it:
        //   ground ink-950 · panel ink-900 (= ink-950 under white/4, their card)
        //   card white/3 · hover white/6 · pressed white/10
        bg: {
          surface: langyDark(ink[900]),
          panel: langyDark(ink[950]),
          page: langyDark(ink[950]),
          subtle: langyDark(white(0.03)),
          muted: langyDark(white(0.06)),
          emphasized: langyDark(white(0.1)),
        },

        // ── Text ────────────────────────────────────────────────────────────
        fg: {
          DEFAULT: langyDark("#ffffff"),
          muted: langyDark(white(0.55)),
          subtle: langyDark(white(0.35)),
        },

        // ── Hairlines ───────────────────────────────────────────────────────
        // `border` and `border.muted` are the SAME on dark: the site draws the
        // card edge and the dividers inside it with one line, `white/10`.
        border: {
          DEFAULT: langyDark(white(0.1)),
          muted: langyDark(white(0.1)),
          emphasized: langyDark(white(0.15)),
        },

        // ── Brand orange ────────────────────────────────────────────────────
        // `solid` stays brand-400 on dark: it is the one place white text sits
        // on top of the colour (the send button), and brand-300 is too light to
        // carry it. Everything else — icons, borders, tints — is brand-300, at
        // an alpha, which is the site's only lit colour on ink.
        orange: {
          solid: langyDark(brand[400]),
          fg: langyDark(brand[300]),
          emphasized: langyDark(brand300(0.3)),
          subtle: langyDark(brand300(0.1)),
          muted: langyDark(brand300(0.16)),
        },

        // ── Brand purple ────────────────────────────────────────────────────
        // The categorical accent (agents, simulations, proposals). Pinned so
        // `purple.fg` inside Langy-dark is the SITE's purple, not Chakra's
        // default dark value.
        purple: {
          solid: langyDark("#a855f7"),
          fg: langyDark("#a855f7"),
          emphasized: langyDark("rgba(168, 85, 247, 0.3)"),
          subtle: langyDark("rgba(168, 85, 247, 0.1)"),
          muted: langyDark("rgba(168, 85, 247, 0.16)"),
        },

        // ── Pass / fail ─────────────────────────────────────────────────────
        // Moss and rust are the site's own status accents. The `fg` variants
        // are lifted a little from the raw hexes so 11px text on ink stays
        // legible, the site uses them at larger sizes than Langy does.
        green: {
          fg: langyDark("#7fa06a"),
          solid: langyDark("#5b7a4a"),
        },
        red: {
          fg: langyDark("#d6796a"),
          solid: langyDark("#b85240"),
        },

        // ── Langy's own namespace ───────────────────────────────────────────
        // Values the texture/animation CSS composes into gradients. They live
        // here so the CSS holds no colour of its own — it only references
        // `var(--chakra-colors-langy-*)`. These have no app fallback, so they
        // carry a value on BOTH grounds.
        langy: {
          // The AI mark's gradient stops: brand blue → brand purple → brand
          // orange. This is Langy's IDENTITY (the logo, the thinking shimmer) —
          // deliberately NOT the data language below.
          aiBlue: langy("#5b8def", "#5fa3ff"),
          aiPurple: langy("#a855f7", "#a855f7"),
          aiOrange: langy(brand[500], brand[400]),

          // Bars are DATA, and data is neutral + brand-300. The homepage's Langy
          // section runs its scenario bars as a `white/10` track with a
          // `brand-300/70` fill, settling to moss or rust. No gradient.
          barTrack: langy("#e2e2e2", white(0.1)),
          barFill: langy("rgba(245, 107, 26, 0.75)", brand300(0.7)),

          // The signal grid's line colour (dark only — see
          // platform/app/src/features/langy/langyTheme.css).
          grid: langy("transparent", white(0.035)),

          // Langy's answer text: a step dimmer than `fg`, so a glance separates
          // "what I said" (bright, bubbled) from "what it said" (the quiet
          // page). Light is ink-800 eased toward paper; dark is the site's
          // paper-at-alpha move, one notch under full white.
          answerFg: langy("#363530", white(0.87)),

          // OWN tokens — the generic ones (`bg.muted`/`border.muted`) both
          // resolve to gray.100 in light, making the bubble invisible.
          // Light steps to gray.200 + a gray.300 hairline; dark is unchanged.
          userBubbleBg: langy("#e2e8f0", white(0.06)),
          userBubbleBorder: langy("#cbd5e1", white(0.1)),
        },
      },

      // ── Card lift ─────────────────────────────────────────────────────────
      // `none` on both grounds: on ink because the site's dark sections contain
      // no shadow at all; on light because a hairline on the app surface is
      // enough, and a stack of four shadowed cards in a turn reads as a deck of
      // trading cards rather than a conversation.
      shadows: {
        langyCard: { value: { _langy: "none", _langyDark: "none" } },
      },

      // ── Type scale ──────────────────────────────────────────────────────
      // One notch down: Langy's column is narrow and dense, and the app's
      // default scale read shouty in it. Re-scales every surface at once
      // (message body, rows, cards, composer), the same trick the colours use.
      fontSizes: {
        xs: { value: { _langy: "0.71875rem", _langyDark: "0.71875rem" } },
        sm: { value: { _langy: "0.8125rem", _langyDark: "0.8125rem" } },
        md: { value: { _langy: "0.9375rem", _langyDark: "0.9375rem" } },
        // The answer body: half a step under `sm`, so Langy's prose sits
        // visibly below the user's words without dropping to `xs` caption
        // territory. Base value matches `sm` for any use outside `.langy-root`.
        langyAnswer: {
          value: {
            base: "0.8125rem",
            _langy: "0.78125rem",
            _langyDark: "0.78125rem",
          },
        },
      },
    },

    tokens: {
      // The brand's one card shape.
      radii: {
        langyCard: { value: "14px" },
      },
    },
  },
});
