import type { AnsiColor, AnsiColorName } from "./terminal-ansi-parser.ts";

/**
 * Fixed terminal palette (independent of app theme) calibrated against VS Code
 * scheme; hex values only (not theme tokens).
 */
const NAMED_HEX: Record<AnsiColorName, string> = {
  black: "#6B6B6B",
  red: "#F14C4C",
  green: "#2CD97C",
  yellow: "#F5DE3D",
  blue: "#5DA5F5",
  magenta: "#E56FE5",
  cyan: "#3ECFE0",
  white: "#E8E8E8",
  brightBlack: "#8A8A8A",
  brightRed: "#FF6E6E",
  brightGreen: "#5CEBA1",
  brightYellow: "#FFEB6B",
  brightBlue: "#82BCFF",
  brightMagenta: "#F19BF1",
  brightCyan: "#70E3F0",
  brightWhite: "#FFFFFF",
};

/**
 * Resolve an ANSI colour for Chakra's `color`/`bg` props. Named colours use
 * the fixed palette above; 256-colour and truecolor codes carry an absolute
 * rgb no palette entry represents, so they pass through as hex unchanged.
 */
export function ansiColorToken(color: AnsiColor): string {
  if (color.kind === "named") return NAMED_HEX[color.name];
  return color.hex;
}

/**
 * The terminal "screen" — fixed dark chrome, not the drawer's own light/dark
 * tokens, the same way a code editor's console pane stays dark inside a
 * light IDE: it recreates a real-world surface, not themeable app UI.
 */
export const TERMINAL_TOKENS = {
  screenBg: "#0A0A0A",
  screenFg: "#E8E8E8",
  /**
   * The "Jump to bottom" pill only — everything else sits on `screenBg`,
   * one continuous surface.
   */
  frameBg: "#141414",
  border: "#2A2A2A",
  faint: "#8A8A8A",
  /** Claude's own accent — the mark, the assistant bullet, the cost figure. */
  accent: "#E8926A",
  accentStrong: "#DA7756",
  /** Status colours — a tool that ran, one that failed, a mode change. */
  red: "#F14C4C",
  green: "#2CD97C",
  blue: "#5DA5F5",
  yellow: "#F5DE3D",
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
  addBg: "#0F2E1C",
  addFg: "#2CD97C",
  removeBg: "#3A1418",
  removeFg: "#F14C4C",
} as const;
