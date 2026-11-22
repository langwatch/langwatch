/** Progress spinner; silent when --format json to preserve JSON output. */
import ora, { type Options, type Ora } from "ora";

import { getOutputFormat } from "./errorOutput";

/**
 * An `ora` spinner that stays completely silent when the current command was
 * invoked with JSON output. Drop-in for `ora(text)` / `ora(options)`.
 */
export function createSpinner(textOrOptions?: string | Options): Ora {
  const options: Options =
    typeof textOrOptions === "string" ? { text: textOrOptions } : { ...textOrOptions };

  return ora({
    ...options,
    // Silent for EVERY machine format (json, agents compact JSON): anything
    // the spinner prints would land in the document a parser is reading.
    isSilent: options.isSilent === true || getOutputFormat() !== "text",
  });
}
