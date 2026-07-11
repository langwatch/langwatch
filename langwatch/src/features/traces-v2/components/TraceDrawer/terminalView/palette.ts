import type { AnsiColor, AnsiColorName } from "../../../utils/ansi/ansi";

/**
 * Map each ANSI colour onto a Chakra colour token rather than a raw hex, so the
 * terminal views inherit the design system's theme-aware light/dark values for
 * free. The same escape code (`\x1b[31m`) resolves to `red.fg`, which Chakra
 * already tunes for contrast in both themes — we never hard-code `#ff0000`.
 *
 * Normal colours use the `{palette}.fg` foreground token; the bright variants
 * use the more saturated `{palette}.solid` so bold/bright output still reads as
 * distinct. Black/white fold onto the neutral foreground tokens.
 */
const NAMED_TOKEN: Record<AnsiColorName, string> = {
  black: "fg.subtle",
  red: "red.fg",
  green: "green.fg",
  yellow: "yellow.fg",
  blue: "blue.fg",
  magenta: "purple.fg",
  cyan: "cyan.fg",
  white: "fg",
  brightBlack: "fg.muted",
  brightRed: "red.solid",
  brightGreen: "green.solid",
  brightYellow: "yellow.solid",
  brightBlue: "blue.solid",
  brightMagenta: "purple.solid",
  brightCyan: "cyan.solid",
  brightWhite: "fg",
};

/**
 * Resolve an ANSI colour to a value for Chakra's `color`/`bg` props.
 *
 * Named colours become theme-aware Chakra tokens. 256-colour and truecolor
 * codes carry an absolute rgb that no design token represents, so they pass
 * through as hex — a deliberate, narrow exception for colours the source
 * explicitly pinned.
 */
export function ansiColorToken(color: AnsiColor): string {
  if (color.kind === "named") return NAMED_TOKEN[color.name];
  return color.hex;
}

/**
 * Semantic tokens for the terminal chrome. The "screen" (where output sits) is
 * a subtle panel; the frame and border follow the drawer's own tokens so the
 * view sits inside the drawer without clashing. All theme-aware.
 */
export const TERMINAL_TOKENS = {
  screenBg: "bg.subtle",
  screenFg: "fg",
  frameBg: "bg.panel",
  border: "border.muted",
  faint: "fg.muted",
  /** Claude's own accent — the mark, the assistant bullet, the cost figure. */
  accent: "orange.fg",
  accentStrong: "orange.solid",
} as const;

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
