import chalk from "chalk";
import type { Ora } from "ora";

import {
  readCommandError,
  renderErrorAsJson,
  renderErrorForHumans,
  resolveOutputFormat,
} from "./errorOutput";

/**
 * Collapses `spinner.fail(); console.error(...)` into one call — a bare `spinner.fail()` leaves
 * the starting text on screen with a red X while the real error prints on a separate,
 * unrelated-looking line.
 */

/**
 * Also where a failure becomes OUTPUT: every command funnels its catch through here, so the
 * human vs `--format json` rendering is decided ONCE rather than at ~100 call sites.
 */

/**
 * The spinner writes to stderr (ora's default), so under `--format json` the document has
 * stdout to itself — a parser never has to step over a red X to find it.
 */
export function failSpinner({
  spinner,
  error,
  action,
  format,
}: {
  spinner: Ora;
  error: unknown;
  /** Short description of what was being done, e.g. "fetch agents". */
  action: string;
  /**
   * The command's `--format`, when the caller holds it. Optional: the program
   * records the running command's format on every action, so a command that says
   * nothing still fails in the right shape.
   */
  format?: string;
}): void {
  const domain = readCommandError(error);
  const wantsJson = resolveOutputFormat(format) !== "text";

  // Avoid double-prefixing when the message already starts with "Failed to …"
  // (either a service-layer `*ApiError` from `formatApiErrorForOperation`, or a
  // sentence the platform wrote itself). The "Failed to <action>" prefix goes on
  // the block's first line only; the Details/Suggestions sections follow intact.
  const rendered = wantsJson ? domain.message : renderErrorForHumans(domain);
  const [headline = "", ...block] = rendered.split("\n");
  const sentence = headline.replace(/^Error: /, "");
  const message = [
    /^failed to /i.test(sentence) ? sentence : `Failed to ${action}: ${sentence}`,
    ...block,
  ].join("\n");

  // The machine's copy: structured, on stdout, and nothing else on stdout. The
  // human's copy — one headline line plus the preserved Details/Suggestions
  // block — goes to stderr, written directly, because under `--format json`
  // the spinner itself is silent (see utils/spinner.ts).
  if (wantsJson) {
    console.log(renderErrorAsJson(domain));
    console.error(chalk.red(message));
    return;
  }

  spinner.fail(chalk.red(message));
}
