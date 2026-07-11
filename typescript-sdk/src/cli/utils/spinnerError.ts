import chalk from "chalk";
import type { Ora } from "ora";
import {
  readCommandError,
  renderErrorAsJson,
  renderErrorForHumans,
  resolveOutputFormat,
} from "./errorOutput";

/**
 * Collapses the `spinner.fail(); console.error(...)` pattern into a single
 * call. A bare `spinner.fail()` leaves the spinner's starting text
 * ("Fetching X...") on screen with a red X, then the real error prints
 * on a separate line — two lines that look unrelated.
 *
 * This is also where a failure becomes OUTPUT, in the shape the caller asked
 * for. Every command already funnels its catch through here, so the two
 * renderings — the human block, and the `--format json` document a parser reads
 * — are decided ONCE rather than at ~100 call sites, and no command can forget
 * to do it.
 *
 * The spinner writes to stderr (ora's default), so under `--format json` the
 * document has stdout to itself: a parser never has to step over a red X to
 * find it, and a human still gets a legible line on the other stream.
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
  const wantsJson = resolveOutputFormat(format) === "json";

  // The machine's copy: structured, on stdout, and nothing else on stdout.
  if (wantsJson) {
    console.log(renderErrorAsJson(domain));
  }

  // The human's copy, on stderr. Under `--format json` it stays a single line —
  // the details are already in the document, and repeating them would only be
  // noise on the stream a person is not reading anyway.
  //
  // Avoid double-prefixing when the message already starts with "Failed to …"
  // (either a service-layer `*ApiError` from `formatApiErrorForOperation`, or a
  // sentence the platform wrote itself).
  const rendered = wantsJson ? domain.message : renderErrorForHumans(domain);
  const message = /^failed to /i.test(rendered)
    ? rendered
    : `Failed to ${action}: ${rendered}`;

  spinner.fail(chalk.red(message));
}
