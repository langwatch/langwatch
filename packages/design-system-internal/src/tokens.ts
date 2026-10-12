/**
 * The kit's tokens as values, for the places a CSS variable cannot reach (the
 * Storybook manager theme). `styles.css` declares the same values; a unit test
 * holds the two identical. Colour keys are the CSS names without `--`.
 */
const light = {
  paper: "#ffffff",
  "paper-soft": "#f4f3ef",
  "paper-deep": "#e8e7e1",
  "paper-raised": "#ffffff",
  "ink-900": "#141417",
  "ink-600": "#36352f",
  "ink-500": "#6d6c64",
  "ink-300": "#99988f",
  line: "#e3e2dd",
  "line-strong": "#cfcdc6",
  brand: "#f56b1a",
  "brand-deep": "#d65209",
  "brand-soft": "rgba(245, 107, 26, 0.09)",
  "on-brand": "#ffffff",
  moss: "#5b7a4a",
  "moss-soft": "rgba(91, 122, 74, 0.13)",
  amber: "#b06a2c",
  "amber-soft": "rgba(201, 123, 58, 0.14)",
  rust: "#b85240",
  "rust-soft": "rgba(184, 82, 64, 0.12)",
  backdrop: "rgba(20, 20, 23, 0.32)",
  "shadow-far": "rgba(30, 20, 40, 0.18)",
  "shadow-near": "rgba(30, 20, 40, 0.08)",
} as const;

type ColourName = keyof typeof light;

const dark = {
  paper: "#0a0a0c",
  "paper-soft": "#141416",
  "paper-deep": "#1f1f23",
  "paper-raised": "#17171a",
  "ink-900": "#f0f0ee",
  "ink-600": "#c6c4bf",
  "ink-500": "#8a887f",
  "ink-300": "#6d6c64",
  line: "#26261f",
  "line-strong": "#3b3a34",
  brand: "#ff8a3d",
  "brand-deep": "#ffb380",
  "brand-soft": "rgba(255, 138, 61, 0.12)",
  "on-brand": "#0a0a0c",
  moss: "#8fb87a",
  "moss-soft": "rgba(143, 184, 122, 0.14)",
  amber: "#d99a5e",
  "amber-soft": "rgba(217, 154, 94, 0.15)",
  rust: "#cf8a7a",
  "rust-soft": "rgba(207, 138, 122, 0.14)",
  backdrop: "rgba(0, 0, 0, 0.6)",
  "shadow-far": "rgba(0, 0, 0, 0.5)",
  "shadow-near": "rgba(0, 0, 0, 0.3)",
} as const satisfies Record<ColourName, string>;

export const tokens = {
  light,
  dark,
  font: {
    serif: '"Sentient", ui-serif, Georgia, serif',
    sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  },
  text: { xs: "11px", sm: "12px", md: "14px", lg: "16px", xl: "20px", "2xl": "28px" },
  space: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    12: "48px",
  },
  radius: { sm: "6px", md: "10px", full: "999px" },
  control: { sm: "28px", md: "32px" },
} as const;

export type Tokens = typeof tokens;
export type ThemeName = "light" | "dark";
