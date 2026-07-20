import { defineConfig } from "@chakra-ui/react";

/**
 * Langy's colour theme — a real Chakra config, not a stylesheet of overrides.
 *
 * Two custom CONDITIONS are declared —
 *
 *     _langy      →  ".langy-root &"          (Langy, light)
 *     _langyDark  →  ".dark .langy-root &"    (Langy, dark)
 *
 * — and Langy's palette is attached to the SAME semantic tokens the rest of
 * the app uses (`bg.surface`, `fg.muted`, `border`, `orange.*`). `mergeConfigs`
 * folds these condition keys in beside the app's existing `_light` / `_dark`
 * values rather than replacing them, so:
 *
 *   - every Langy component keeps styling through `bg="bg.surface"` — there is
 *     no Langy-specific prop vocabulary to learn, and no component churn;
 *   - nothing leaks: outside `.langy-root` the app's own values still apply;
 *   - the tokens are typed, discoverable, and live with the design system.
 *
 * The specificity that makes it win falls out of Chakra's own emission:
 * `.dark .langy-root { … }` (0,2,0) beats `.dark` (0,1,0). Verified against
 * `system.getTokenCss()`.
 *
 * ── The two grounds ─────────────────────────────────────────────────────────
 * LIGHT IS THE APP'S OWN PALETTE. Langy in light mode carries NO overrides for
 * surfaces, text, borders or accent ramps: inside `.langy-root` the standard
 * light tokens apply unchanged, so the panel reads as part of the product. (A
 * warm paper palette was tried here and read as a beige island next to the
 * app's white surfaces.) The `_langy` condition survives for the tokens that
 * have no app-level fallback: Langy's own `langy.*` namespace and the panel's
 * type scale.
 *
 * DARK IS THE MARKETING SITE'S INK. Lifted from the homepage's dark sections
 * (`SectionLangy`, `SectionEnterprise`) — the very sections that present
 * Langy:
 *
 *   - TEXT IS PAPER AT ALPHA, NOT GREY. The site never writes a grey on ink; it
 *     writes white and turns it down (`text-paper/55`, `/35`).
 *   - ONE HAIRLINE: `white/10`, used for the card edge AND the dividers inside
 *     it. `white/15` is the only step up.
 *   - ELEVATION IS LIGHT, NOT GREY: every surface above the ink ground is
 *     white-alpha (3% → 6% → 10%), so a raised surface is the same ground with
 *     more light on it.
 *   - NO SHADOWS. `grep -c shadow` over both dark sections returns 0.
 *   - ONE ACCENT: brand-300 (#ffb380) at an alpha, plus moss/rust for pass/fail.
 *
 * Spec: specs/langy/langy-panel-theme.feature
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
        // ── Surfaces (dark only — light is the app's own) ───────────────────
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
        // legible — the site uses them at larger sizes than Langy does.
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

          // The signal grid's line colour (dark only — see langyTheme.css).
          grid: langy("transparent", white(0.035)),
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

      // ── Type scale ────────────────────────────────────────────────────────
      // One notch down. Langy's column is narrow and dense; the app's default
      // scale read shouty in it. Overriding the font-size tokens under the Langy
      // conditions re-scales every surface at once (message body, rows, cards,
      // composer) with no per-component edits — the same trick the colours use.
      // `2xs` is left alone: it is already at the floor.
      fontSizes: {
        xs: { value: { _langy: "0.71875rem", _langyDark: "0.71875rem" } },
        sm: { value: { _langy: "0.8125rem", _langyDark: "0.8125rem" } },
        md: { value: { _langy: "0.9375rem", _langyDark: "0.9375rem" } },
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
