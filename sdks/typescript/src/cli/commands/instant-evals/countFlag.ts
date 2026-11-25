/**
 * Reads a count flag the same way for every command: `Number("abc")` would travel as `null` and
 * come back as a confusing schema refusal. The server's ceilings are enforced here, by name.
 */

import { commandValidationError, reportCommandError } from "../../utils/errorOutput";

/** Judgements one page may hold, matching the server's ceiling. */
export const INSTANT_EVAL_RESULTS_CEILING = 1_000;

/** Runs one page of the list may hold, matching the server's ceiling. */
export const INSTANT_EVAL_LIST_CEILING = 100;

/** Rows one sample may hold, matching the server's ceiling. */
export const INSTANT_EVAL_SAMPLE_CEILING = 25;

function refuse(message: string): never {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
}

/**
 * The count a flag asked for, or a refusal naming the flag and the ceiling. Answers undefined when
 * the flag was not written, so a caller leaves the field off the request and the server applies its
 * own default.
 */
export function readCountFlag({
  raw,
  flag,
  max,
}: {
  raw: string | number | undefined;
  /** How the flag is spelled, so a refusal names what the caller typed. */
  flag: string;
  max: number;
}): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    refuse(`Invalid ${flag} value: ${raw} (write a positive whole number)`);
  }
  if (value > max) {
    refuse(`Invalid ${flag} value: ${raw} (the most allowed is ${max})`);
  }
  return value;
}
