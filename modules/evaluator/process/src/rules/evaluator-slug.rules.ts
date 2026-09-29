import { randomInt } from "node:crypto";

const MAX_BASE_LENGTH = 50;
const SUFFIX_LENGTH = 5;
const SUFFIX_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * The slug an evaluator is addressed by: the slugified name plus a random
 * five-character suffix, so two evaluators sharing a name get distinct slugs.
 * The slugify is `strict`, as on main: "v2.0" becomes "v20", accents are dropped.
 */
export function generateEvaluatorSlug(name: string): string {
  const base = name
    .replaceAll(/[:?&_]/g, "-")
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, "")
    .trim()
    .replaceAll(/[-\s]+/g, "-")
    .replace(/^-/, "")
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-$/, "");
  const suffix = Array.from({ length: SUFFIX_LENGTH }, () =>
    SUFFIX_ALPHABET.charAt(randomInt(SUFFIX_ALPHABET.length)),
  ).join("");

  return base ? `${base}-${suffix}` : suffix;
}
