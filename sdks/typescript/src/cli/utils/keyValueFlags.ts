/**
 * Repeatable `key=value` command-line flags. A spend filter may repeat one
 * key with several values; a run parameter holds one value per name. Equals
 * rather than colon, because a value may itself contain a colon.
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
 * `--metadata tier=gold`, repeated, collected where one key may carry
 * several values. A key may not contain a colon: the server splits on the
 * FIRST one, so a key carrying one would silently address a different key.
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
 * Reads one flag value as the type it looks like: `true`/`false` becomes
 * boolean, a round-tripping number becomes a number (keeping `007`/`1.50` as
 * text), else text. A declared type overrides the guess.
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
  if (type === "number") return coerceDeclaredNumber(value);
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
 * supplies for names its scenarios declare. A name repeated keeps the last
 * value, so a wrapper script can append an override it did not write.
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

function coerceDeclaredNumber(value: string): RunParameterValue {
  const asNumber = Number(value);
  if (value.trim() === "") return value;
  if (!Number.isFinite(asNumber)) return value;
  return asNumber;
}
