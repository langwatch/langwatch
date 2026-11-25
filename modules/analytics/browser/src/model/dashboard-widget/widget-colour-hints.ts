/**
 * Hints, never errors: a hard-coded colour in widget code still saves and runs. The hint
 * points at `LW.palette` so the chart follows light and dark instead of staying one mode.
 */

export interface RawColourHint {
  /** 1-based, as Monaco and editors number lines. */
  readonly line: number;
  /** 1-based column of the opening quote. */
  readonly column: number;
  readonly length: number;
  readonly hex: string;
  readonly message: string;
}

/**
 * A quoted hex literal, e.g. `"#9f7aea"`. Matches only string literals so CSS written inside
 * a template string, and a `#` used as a comment, are not flagged.
 */
const QUOTED_HEX = /(["'`])#([0-9a-fA-F]{3,8})\1/g;

/** The hint text, exported so the editor and tests show the same words. */
export const RAW_COLOUR_HINT_MESSAGE =
  "Hard-coded colour: prefer LW.palette.series[n] or LW.chartStyle so it follows light and dark.";

export function rawColourHints(source: string): readonly RawColourHint[] {
  const hints: RawColourHint[] = [];
  source.split("\n").forEach((text, index) => {
    for (const match of text.matchAll(QUOTED_HEX)) {
      hints.push({
        line: index + 1,
        column: (match.index ?? 0) + 1,
        length: match[0].length,
        hex: `#${match[2]}`,
        message: RAW_COLOUR_HINT_MESSAGE,
      });
    }
  });
  return hints;
}
