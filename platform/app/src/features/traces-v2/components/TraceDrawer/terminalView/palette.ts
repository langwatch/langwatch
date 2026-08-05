import type { AnsiColor, AnsiColorName } from "../../../utils/ansi/ansi";

/**
 * A real terminal is dark, saturated, and high-contrast — REGARDLESS of
 * whether the app around it is in light or dark mode. Every value below is a
 * fixed hex, not a Chakra semantic token: the app's `.fg`/`.solid` tokens are
 * deliberately toned down for body text, and that reads as washed-out here.
 * This is the same class of exception `ansiColorToken`'s truecolor passthrough
 * already made — pinned because the design requirement IS a specific,
 * unthemed palette (what a real terminal looks like), not a themeable one.
 *
 * Named colours below are calibrated against a common dark terminal ANSI
 * scheme (the one VS Code's integrated terminal ships), not invented —
 * verified readable against the mark's own gradient and against each other.
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
 * Resolve an ANSI colour to a value for Chakra's `color`/`bg` props.
 *
 * Named colours resolve to the fixed terminal palette above. 256-colour and
 * truecolor codes carry an absolute rgb that no palette entry represents, so
 * they pass through as hex too — the source pinned an exact colour, and nothing
 * here should override it.
 */
export function ansiColorToken(color: AnsiColor): string {
  if (color.kind === "named") return NAMED_HEX[color.name];
  return color.hex;
}

/**
 * The terminal "screen" — fixed dark chrome, not the drawer's own
 * light/dark tokens. A code editor's console pane stays dark inside an
 * otherwise light IDE theme for the same reason: it's recreating a specific
 * real-world surface, not part of the app's own themeable UI.
 */
export const TERMINAL_TOKENS = {
  screenBg: "#0A0A0A",
  screenFg: "#E8E8E8",
  /** The "Jump to bottom" pill only — everything else sits on `screenBg` itself, one continuous surface. */
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
 * A real terminal font stack, not the generic system-mono Chakra's `mono`
 * token resolves to. Nerd Font variants come first — the ones developers who
 * customise their shell prompt are most likely to already have installed
 * (Powerlevel10k's own setup guide recommends MesloLGS NF specifically) —
 * carrying the box-drawing and powerline glyphs a plain system mono lacks.
 * Falls through to the same system stack when none is installed, so nothing
 * breaks for a reader who's never touched their terminal font.
 */
export const TERMINAL_FONT_STACK =
  '"MesloLGS NF", "FiraCode Nerd Font", "JetBrainsMono Nerd Font", "Hack Nerd Font", ui-monospace, "SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

/**
 * The startup mark's shading, left to right — a warm terracotta gradient, not
 * one flat colour. This is the same kind of narrow, deliberate exception as
 * `ansiColorToken`'s truecolor passthrough above: Chakra's palette has no
 * multi-stop gradient token, and the mark is a fixed piece of brand art, not
 * themeable UI chrome, so it is pinned here rather than left to a token that
 * doesn't exist.
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
