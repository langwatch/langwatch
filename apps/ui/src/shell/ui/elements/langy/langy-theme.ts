import { defineConfig } from "@langwatch/design-system/system";

/** Langy's typography and identity sit on the shared semantic colour system. */
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
        langy: {
          // The mark and thinking shimmer preserve Langy's identity artwork.
          aiBlue: langy("#5b8def", "#5fa3ff"),
          aiPurple: langy("#a855f7", "#a855f7"),
          aiOrange: langy("#f56b1a", "#ff8a3d"),
          barTrack: { value: "{colors.bg.control}" },
          barFill: { value: "{colors.accent.fg}" },
          grid: langy("transparent", "color-mix(in srgb, {colors.fg} 4%, transparent)"),
          answerFg: { value: "{colors.fg.muted}" },
          userBubbleBg: { value: "{colors.bg.nested}" },
          userBubbleBorder: { value: "{colors.border.nested}" },
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
