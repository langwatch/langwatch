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

/**
 * Terminal chrome: a fixed dark screen in both colour modes, because the tab
 * recreates a real terminal rather than themeable app UI.
 */
export const TERMINAL_TOKENS = {
  screenBg: "terminal.bg",
  screenFg: "terminal.fg",
  frameBg: "terminal.frame",
  border: "terminal.border",
  faint: "terminal.faint",
  accent: "terminal.accent",
  selection: "terminal.blue/33",
  red: "terminal.red",
  green: "terminal.green",
  blue: "terminal.blue",
  yellow: "terminal.yellow",
} as const;

/**
 * Terminal font stack: Nerd Fonts first (Powerlevel10k support), falling
 * through to system mono when none installed.
 */
export const TERMINAL_FONT_STACK =
  '"MesloLGS NF", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/** Full-width, saturated — not a subtle tint. Matches a real diff pager. */
export const DIFF_TOKENS = {
  addBg: "terminal.diffAddBg",
  addFg: "terminal.green",
  removeBg: "terminal.diffRemoveBg",
  removeFg: "terminal.red",
} as const;
