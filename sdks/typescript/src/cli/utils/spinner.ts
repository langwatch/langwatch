/**
 * The one place a command gets its progress spinner from.
 *
 * Under `--format json` the CLI's stdout is a machine contract: one JSON
 * document and nothing else. The spinner already writes to stderr (ora's
 * default), but the callers that matter — Langy's agent, CI shells — routinely
 * MERGE stderr into stdout, and then every "✔ Found 3 traces" line lands in the
 * middle of the document a parser is trying to read. The platform grew
 * noise-stripping to cope (`reduceJSONOutput` in the langyagent adapter); this
 * helper removes the noise at the source instead: when the running command was
 * invoked with `--format json` (or a boolean `--json`), the spinner is silent —
 * no frames, no ✔/✖ lines, nothing.
 *
 * The format is read from `getOutputFormat()`, which the program's `preAction`
 * hook sets before any command module loads, so this works identically for a
 * cold process and for a command served by the warm daemon.
 */
import ora, { type Options, type Ora } from "ora";
import { getOutputFormat } from "./errorOutput";

/**
 * An `ora` spinner that stays completely silent when the current command was
 * invoked with JSON output. Drop-in for `ora(text)` / `ora(options)`.
 */
export function createSpinner(textOrOptions?: string | Options): Ora {
  const options: Options =
    typeof textOrOptions === "string"
      ? { text: textOrOptions }
      : { ...(textOrOptions ?? {}) };

  return ora({
    ...options,
    // Silent for EVERY machine format (json, agents compact JSON): anything
    // the spinner prints would land in the document a parser is reading.
    isSilent: options.isSilent === true || getOutputFormat() !== "text",
  });
}
