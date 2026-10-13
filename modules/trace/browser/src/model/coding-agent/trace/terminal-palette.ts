import type { AnsiColor } from "./terminal-ansi-parser.ts";

/**
 * Resolve an ANSI colour for Chakra's `color`/`bg` props. Named colours use
 * terminal tokens; 256-colour and truecolor codes carry an absolute
 * rgb no palette entry represents, so they pass through as hex unchanged.
 */
export function ansiColorToken(color: AnsiColor): string {
  if (color.kind === "named") return `terminal.${color.name}`;
  return color.hex;
}

/** Terminal chrome follows the drawer colour mode. */
export const TERMINAL_TOKENS = {
  screenBg: "terminal.bg",
  screenFg: "terminal.fg",
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

/** Full-width, saturated — not a subtle tint. Matches a real diff pager. */
export const DIFF_TOKENS = {
  addBg: "bg.success",
  addFg: "fg.success",
  removeBg: "bg.error",
  removeFg: "fg.error",
} as const;
