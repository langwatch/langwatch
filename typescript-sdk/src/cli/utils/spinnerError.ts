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
  // human's copy stays a single line on stderr — written directly, because
  // under `--format json` the spinner itself is silent (see utils/spinner.ts).
  if (wantsJson) {
    console.log(renderErrorAsJson(domain));
    console.error(chalk.red(message));
    return;
  }

  spinner.fail(chalk.red(message));
}
