import { extendTheme, type ThemeConfig } from "@chakra-ui/react";

const config: ThemeConfig = {
  initialColorMode: "dark",
  useSystemColorMode: false,
};

export const theme = extendTheme({
  config,
  fonts: {
    heading: "'Share Tech Mono', monospace",
    body: "'Share Tech Mono', monospace",
    mono: "'Share Tech Mono', monospace",
  },
  styles: {
    global: {
      body: {
        bg: "#000408",
        color: "#b0c4d8",
      },
    },
  },
  colors: {
    brand: {
      50: "#e0fffe",
      100: "#b3fffd",
      200: "#80fffc",
      300: "#4dfcfb",
      400: "#00f0ff",
      500: "#00d4e0",
      600: "#00a5b0",
      700: "#007880",
      800: "#004a50",
      900: "#001e20",
    },
  },
  semanticTokens: {
    colors: {
      // Surfaces
      "surface.canvas": { default: "#000408", _dark: "#000408" },
      "surface.card": { default: "#0a0e17", _dark: "#0a0e17" },
      "surface.input": { default: "#060a12", _dark: "#060a12" },
      "surface.hover": { default: "rgba(0, 240, 255, 0.06)", _dark: "rgba(0, 240, 255, 0.06)" },
      "surface.code": { default: "#060a12", _dark: "#060a12" },
      "surface.tooltip": { default: "#0a0e17", _dark: "#0a0e17" },

      // Borders
      "border.subtle": { default: "rgba(0, 240, 255, 0.15)", _dark: "rgba(0, 240, 255, 0.15)" },
      "border.input": { default: "rgba(0, 240, 255, 0.25)", _dark: "rgba(0, 240, 255, 0.25)" },

      // Text
      "text.primary": { default: "#b0c4d8", _dark: "#b0c4d8" },
      "text.secondary": { default: "#6a8a9a", _dark: "#6a8a9a" },
      "text.muted": { default: "#4a6a7a", _dark: "#4a6a7a" },
      "text.inverted": { default: "#000408", _dark: "#000408" },

      // Row hover
      "row.hover": { default: "rgba(0, 240, 255, 0.04)", _dark: "rgba(0, 240, 255, 0.04)" },

      // Status badge backgrounds — neon style
      "badge.ok": { default: "rgba(0, 255, 65, 0.12)", _dark: "rgba(0, 255, 65, 0.12)" },
      "badge.ok.text": { default: "#00ff41", _dark: "#00ff41" },
      "badge.blocked": { default: "rgba(255, 0, 51, 0.15)", _dark: "rgba(255, 0, 51, 0.15)" },
      "badge.blocked.text": { default: "#ff0033", _dark: "#ff0033" },
      "badge.stale": { default: "rgba(255, 170, 0, 0.12)", _dark: "rgba(255, 170, 0, 0.12)" },
      "badge.stale.text": { default: "#ffaa00", _dark: "#ffaa00" },
      "badge.neutral": { default: "rgba(0, 240, 255, 0.08)", _dark: "rgba(0, 240, 255, 0.08)" },
      "badge.neutral.text": { default: "#4a8a9a", _dark: "#4a8a9a" },
      "badge.pending": { default: "rgba(0, 240, 255, 0.1)", _dark: "rgba(0, 240, 255, 0.1)" },
      "badge.pending.text": { default: "#00f0ff", _dark: "#00f0ff" },
      "badge.active": { default: "rgba(0, 255, 65, 0.12)", _dark: "rgba(0, 255, 65, 0.12)" },
      "badge.active.text": { default: "#00ff41", _dark: "#00ff41" },

      // Chart
      "chart.tick": { default: "#4a6a7a", _dark: "#4a6a7a" },
      "chart.stroke": { default: "#00f0ff", _dark: "#00f0ff" },
      "chart.tooltipBg": { default: "#0a0e17", _dark: "#0a0e17" },
      "chart.tooltipBorder": { default: "rgba(0, 240, 255, 0.3)", _dark: "rgba(0, 240, 255, 0.3)" },
    },
  },
  components: {
    Table: {
      variants: {
        simple: {
          th: {
            color: "#00f0ff",
            borderColor: "rgba(0, 240, 255, 0.15)",
            fontSize: "xs",
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            fontFamily: "'Share Tech Mono', monospace",
          },
          td: {
            borderColor: "rgba(0, 240, 255, 0.08)",
          },
        },
      },
    },
    Badge: {
      baseStyle: {
        borderRadius: "2px",
        fontFamily: "'Share Tech Mono', monospace",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      },
    },
    Button: {
      baseStyle: {
        borderRadius: "2px",
        fontFamily: "'Share Tech Mono', monospace",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      },
    },
    Input: {
      baseStyle: {
        field: {
          borderRadius: "2px",
          fontFamily: "'Share Tech Mono', monospace",
        },
      },
    },
    Code: {
      baseStyle: {
        borderRadius: "2px",
        fontFamily: "'Share Tech Mono', monospace",
      },
    },
  },
});
