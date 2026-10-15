import chalk from "chalk";

/** LangWatch accent orange, used to tint the CLI notice tag. */
const LANGWATCH_ORANGE = "#ED8926";

/** Styled `langwatch` tag: spark + bold orange brand name. chalk auto-strips
 * color when not a TTY, so plain-text consumers get `✦ langwatch ...`. */
export function lwTag(): string {
  return chalk.hex(LANGWATCH_ORANGE).bold("✦ langwatch");
}
