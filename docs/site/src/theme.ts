import { createDesignSystem, defineConfig } from "@langwatch/design-system/system";

const colour = ({ light, dark }: { light: string; dark: string }) => ({
  value: { _light: light, _dark: dark },
});

// Docs-local theme candidates: paper, canvas, ground, primary and controlBorder.
// Brand orange is retained for decoration; its darker text companion meets AA on light surfaces.
export const docsSystem = createDesignSystem(
  defineConfig({
    theme: {
      semanticTokens: {
        colors: {
          docs: {
            paper: colour({ light: "#fffefc", dark: "#16181b" }),
            canvas: { value: "{colors.docs.paper}" },
            primary: colour({ light: "#e17100", dark: "#fe9a00" }),
            controlBorder: colour({ light: "#87817b", dark: "#77736f" }),
            body: colour({ light: "#3b3835", dark: "#d6d3d0" }),
            lede: colour({ light: "#5f5a55", dark: "#a8a4a0" }),
            contents: colour({ light: "#6f6a65", dark: "#9a9692" }),
            tile: colour({ light: "#ecebe8", dark: "#24272b" }),
            action: colour({ light: "#26694d", dark: "#26694d" }),
            actionText: colour({ light: "#ffffff", dark: "#ffffff" }),
            banner: colour({ light: "#e17100", dark: "#e17100" }),
            bannerText: colour({ light: "#09090b", dark: "#09090b" }),
            rule: colour({
              light: "linear-gradient(90deg, #cddcf9, #ffaf6e, transparent)",
              dark: "linear-gradient(90deg, #3b5bdb, #c97b3a, transparent)",
            }),
            ground: colour({
              light:
                "radial-gradient(ellipse at 15% 0%, #cddcf9 0%, transparent 65%), radial-gradient(ellipse at 85% 10%, #ffaf6e 0%, transparent 65%), {colors.docs.canvas}",
              dark: "radial-gradient(ellipse at 15% 0%, #1d2a44 0%, transparent 65%), radial-gradient(ellipse at 85% 10%, #7a4a22 0%, transparent 65%), {colors.docs.canvas}",
            }),
          },
          bg: {
            DEFAULT: { value: "{colors.bg.surface}" },
            surface: { value: "{colors.docs.paper}" },
            panel: { value: "{colors.bg.surface}" },
            subtle: colour({ light: "#f5f4f1", dark: "#202327" }),
            muted: { value: "{colors.bg.subtle}" },
            control: { value: "{colors.bg.subtle}" },
            nested: colour({ light: "{colors.docs.paper}", dark: "#101215" }),
            hover: { value: "{colors.bg.subtle}" },
          },
          fg: {
            DEFAULT: colour({ light: "#201e1b", dark: "#ece9e6" }),
            muted: colour({ light: "#625d58", dark: "#aaa6a3" }),
            subtle: { value: "{colors.fg.muted}" },
          },
          nav: { fg: colour({ light: "#4d4945", dark: "#b4b0ac" }) },
          border: {
            DEFAULT: colour({ light: "#e5e2df", dark: "#34373b" }),
            muted: colour({ light: "#efedeb", dark: "#2b2e32" }),
            nested: { value: "{colors.border}" },
            emphasized: { value: "{colors.docs.controlBorder}" },
          },
          accent: {
            solid: { value: "{colors.docs.primary}" },
            fg: colour({ light: "#a95000", dark: "#fe9a00" }),
            subtle: colour({ light: "#fdf1e4", dark: "#2a1d08" }),
            indicator: { value: "{colors.accent.fg}" },
          },
        },
      },
      tokens: {
        fonts: {
          body: { value: "Inter, ui-sans-serif, system-ui, sans-serif" },
          heading: { value: "Inter, ui-sans-serif, system-ui, sans-serif" },
        },
      },
    },
  }),
);
