import type { AnsiColor, AnsiColorName } from "./terminal-ansi-parser.ts";

/**
 * Named ANSI colours follow the active theme; truecolour payloads remain absolute.
 */
const NAMED_TOKENS: Record<AnsiColorName, string> = {
  black: "fg.subtle",
  red: "red.fg",
  green: "green.fg",
  yellow: "yellow.fg",
  blue: "blue.fg",
  magenta: "purple.fg",
  cyan: "cyan.fg",
  white: "fg",
  brightBlack: "fg.muted",
  brightRed: "red.fg",
  brightGreen: "green.fg",
  brightYellow: "yellow.fg",
  brightBlue: "blue.fg",
  brightMagenta: "pink.fg",
  brightCyan: "cyan.fg",
  brightWhite: "fg",
};

/**
 * Resolve an ANSI colour for Chakra's `color`/`bg` props. Named colours use
 * the fixed palette above; 256-colour and truecolor codes carry an absolute
 * rgb no palette entry represents, so they pass through as hex unchanged.
 */
export function ansiColorToken(color: AnsiColor): string {
  if (color.kind === "named") return NAMED_TOKENS[color.name];
  return color.hex;
}

/** Terminal chrome follows the drawer colour mode. */
export const TERMINAL_TOKENS = {
  screenBg: "bg.card",
  screenFg: "fg",
  frameBg: "bg.raised",
  border: "border.strong",
  faint: "fg.subtle",
  accent: "accent.fg",
  accentStrong: "accent.fg",
  red: "fg.error",
  green: "fg.success",
  blue: "fg.info",
  yellow: "fg.warning",
} as const;

/**
 * Terminal font stack: Nerd Fonts first (Powerlevel10k support), falling
 * through to system mono when none installed.
 */
export const TERMINAL_FONT_STACK =
  '"MesloLGS NF", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * The startup mark's shading, left to right — a warm terracotta gradient, not
 * one flat colour. Like `ansiColorToken`'s truecolor passthrough: Chakra has
 * no multi-stop gradient token, and this is fixed brand art, not themeable UI.
 */
export const CLAUDE_MARK_GRADIENT = [
  "#F2C4AA",
  "#E8A587",
  "#DA7756",
  "#C15F3C",
  "#9C4A2E",
] as const;

/** Full-width, saturated — not a subtle tint. Matches a real diff pager. */
export const DIFF_TOKENS = {
  addBg: "bg.success",
  addFg: "fg.success",
  removeBg: "bg.error",
  removeFg: "fg.error",
} as const;
