import type { DesignSystemExtension } from "@langwatch/design-system/system";

const colour = ({ light, dark }: { light: string; dark: string }) => ({
  value: { _light: light, _dark: dark },
});

// Brand palette from langwatch.ai/brand: paper, ink and orange (#f56b1a).
// Orange decorates; its darker brand-700 companion carries text and meets AA on paper.
export const docsTheme = {
  theme: {
    semanticTokens: {
      colors: {
        docs: {
          paper: colour({ light: "#ffffff", dark: "#141417" }),
          canvas: colour({ light: "#ffffff", dark: "#141417" }),
          sidebar: colour({ light: "#ffffff", dark: "#141417" }),
          raised: colour({ light: "#ffffff", dark: "#1b1b1f" }),
          chrome: colour({ light: "#ffffffe6", dark: "#141417e6" }),
          shadow: colour({ light: "#14141714", dark: "#00000055" }),
          shadowStrong: colour({ light: "#14141721", dark: "#00000080" }),
          primary: colour({ light: "#f56b1a", dark: "#f56b1a" }),
          primaryText: colour({ light: "#141417", dark: "#141417" }),
          controlBorder: colour({ light: "#8a8981", dark: "#77766f" }),
          body: colour({ light: "#36352f", dark: "#d6d5d0" }),
          lede: colour({ light: "#4d4d46", dark: "#aaa9a2" }),
          contents: colour({ light: "#5e5d56", dark: "#9a9992" }),
          action: colour({ light: "#141417", dark: "#f0f0ee" }),
          actionText: colour({ light: "#ffffff", dark: "#141417" }),
          logoChip: colour({ light: "#ffffff", dark: "#eeece8" }),
          logoChipRing: { value: "rgba(32, 30, 27, 0.1)" },
        },
        bg: {
          DEFAULT: { value: "{colors.bg.surface}" },
          surface: { value: "{colors.docs.paper}" },
          panel: { value: "{colors.bg.surface}" },
          subtle: colour({ light: "#f7f7f5", dark: "#1e1e22" }),
          muted: { value: "{colors.bg.subtle}" },
          control: { value: "{colors.bg.subtle}" },
          nested: colour({ light: "#f7f7f5", dark: "#0a0a0c" }),
          hover: { value: "{colors.bg.subtle}" },
        },
        fg: {
          DEFAULT: colour({ light: "#141417", dark: "#f0f0ee" }),
          muted: colour({ light: "#4d4d46", dark: "#aaa9a2" }),
          subtle: { value: "{colors.fg.muted}" },
        },
        nav: { fg: colour({ light: "#4d4d46", dark: "#b4b3ac" }) },
        border: {
          DEFAULT: colour({ light: "#e3e2dd", dark: "#2e2e33" }),
          muted: colour({ light: "#f0f0ee", dark: "#232327" }),
          nested: { value: "{colors.border}" },
          emphasized: { value: "{colors.docs.controlBorder}" },
        },
        accent: {
          solid: { value: "{colors.docs.primary}" },
          fg: colour({ light: "#a83e05", dark: "#ff8a3d" }),
          subtle: colour({ light: "#fff1e7", dark: "#2a1a0e" }),
          indicator: { value: "{colors.accent.fg}" },
        },
      },
    },
    tokens: {
      fonts: {
        body: { value: "Inter, ui-sans-serif, system-ui, sans-serif" },
        heading: {
          value: 'Sentient, Charter, "Source Serif Pro", ui-serif, Georgia, serif',
        },
        mono: { value: '"JetBrains Mono", ui-monospace, SFMono-Regular, monospace' },
      },
    },
  },
} satisfies DesignSystemExtension;
