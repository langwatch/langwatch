/**
 * Repeatable `key=value` command-line flags.
 *
 * Two families share the same shape on the command line and differ in what a
 * key holds: a spend filter may repeat one key with several values, while a run
 * parameter holds exactly one value per name, read as the type it looks like.
 *
 * Equals rather than a colon, because a value may itself contain a colon and a
 * shell user expects `key=value`.
 */

import { commandValidationError, reportCommandError } from "./errorOutput";

/** The value types a run parameter may hold once read off the command line. */
export type RunParameterValue = string | number | boolean;

/** The type a parameter declares, which settles how its flag value is read. */
export type RunParameterType = "string" | "number" | "boolean";

/** The flag every run command reads its parameter values from. */
export const PARAM_FLAG = "--param";

/**
 * End the command on a malformed flag. Reported through the domain error path
 * so a caller running with a machine format gets the structured document
 * rather than a bare line of prose on stdout.
 */
const rejectFlag = (message: string): never => {
  reportCommandError({ error: commandValidationError(message) });
  process.exit(1);
};

const splitPair = ({
  pair,
  flag,
}: {
  pair: string;
  flag: string;
}): { key: string; value: string } => {
  const separator = pair.indexOf("=");
  if (separator <= 0) {
    rejectFlag(`Invalid ${flag} value: ${pair} (expected key=value)`);
  }
  return { key: pair.slice(0, separator), value: pair.slice(separator + 1) };
};

/**
 * `--metadata tier=gold`, repeated, collected into a record where one key may
 * carry several values.
 *
 * A key may not contain a colon: the server splits a pair on its FIRST colon,
 * so a key carrying one would silently address a different key. Refusing beats
 * reporting spend for a filter the caller did not write.
 */
export const parseKeyValueFlags = ({
  pairs,
  flag,
}: {
  pairs: string[] | undefined;
  flag: string;
}): Record<string, string[]> | undefined => {
  if (pairs === undefined || pairs.length === 0) return undefined;
  // A Map, not an object literal: `parsed["__proto__"]` on a literal reads back
  // Object.prototype, so the `??=` would never assign and the push would land
  // on the prototype as a TypeError rather than as this command's own clean
  // validation error.
  const parsed = new Map<string, string[]>();
  for (const pair of pairs) {
    const { key, value } = splitPair({ pair, flag });
    if (key.includes(":")) {
      rejectFlag(`Invalid ${flag} key: ${key} (a key cannot contain a colon)`);
    }
    if (value === "") {
      rejectFlag(
        `Invalid ${flag} value: ${pair} (an empty value would match every request that lacks the key)`,
      );
    }
    const existing = parsed.get(key);
    if (existing) existing.push(value);
    else parsed.set(key, [value]);
  }
  return Object.fromEntries(parsed);
};

/**
 * Read one flag value as the type it looks like: exactly `true` or `false`
 * becomes a boolean, a number that renders back to exactly what was typed
 * becomes a number, and everything else stays text.
 *
 * The round-trip check is what keeps `007`, `1.50` and a twenty-digit account
 * number as text: they are identifiers that merely look numeric, and handing
 * the run a number would change the value it was given.
 *
 * A declared type settles the guess: a string parameter keeps "007" as text,
 * a number parameter reads "5" as 5 (and "007" as 7), and a boolean one reads
 * `true` and `false`. Text that cannot be read as the declared type stays
 * text, and the platform refuses it by name.
 */
export const coerceParameterValue = ({
  value,
  type,
}: {
  value: string;
  /** The type the target declares for this name, when it declares one. */
  type?: RunParameterType;
}): RunParameterValue => {
  if (type === "string") return value;
  if (type === "number") {
    const asNumber = Number(value);
    return value.trim() !== "" && Number.isFinite(asNumber) ? asNumber : value;
  }
  if (type === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }
  if (value === "true") return true;
  if (value === "false") return false;
  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && String(asNumber) === value) return asNumber;
  return value;
};

/**
 * `--param account_tier=gold`, repeated, collected into the values a run
 * supplies for the names its scenarios declare.
 *
 * A name repeated across flags keeps the last value, so a wrapper script can
 * append an override to a command line it did not write.
 */
export const parseRunParameterFlags = ({
  pairs,
  types,
}: {
  pairs: string[] | undefined;
  /** The declared type of each name, when the target declares any. */
  types?: ReadonlyMap<string, RunParameterType>;
}): Record<string, RunParameterValue> | undefined => {
  if (pairs === undefined || pairs.length === 0) return undefined;
  // A Map for the same reason as above: assigning `__proto__` on an object
  // literal runs the prototype setter, which ignores a string, so the pair
  // would be dropped without a word rather than reaching the server that
  // rejects it by name.
  const parsed = new Map<string, RunParameterValue>();
  for (const pair of pairs) {
    const { key, value } = splitPair({ pair, flag: PARAM_FLAG });
    parsed.set(key, coerceParameterValue({ value, type: types?.get(key) }));
  }
  return Object.fromEntries(parsed);
};
