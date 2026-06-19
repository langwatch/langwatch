import chalk from "chalk";

/** LangWatch accent orange, used to tint the CLI notice tag. */
const LANGWATCH_ORANGE = "#ED8926";

/**
 * The styled `langwatch` tag that prefixes wrapper notices. A small spark
 * plus the brand name in bold orange so the chatter reads as LangWatch and
 * not a generic log line. chalk auto-strips the color when stdout is not a
 * TTY (piped / CI), so plain-text consumers still get `✦ langwatch ...`.
 *
 * Replaces the flat `langwatch:` prefix. Call sites read as a sentence,
 * e.g. `${lwTag()} saved.` -> "✦ langwatch saved.".
 */
export function lwTag(): string {
  return chalk.hex(LANGWATCH_ORANGE).bold("✦ langwatch");
}
