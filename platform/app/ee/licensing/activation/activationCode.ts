/**
 * The short code a fresh install pastes instead of a license blob (ADR-139,
 * section 5).
 *
 * Pure: no environment, no database. The backoffice mints a code here and the
 * connect host looks one up here, so both sides share one spelling of what a
 * code is and how it is stored.
 *
 * **What is stored is not what is presented.** The registry holds the SHA-256
 * of the normalised code, and every lookup hashes what the caller presented
 * before comparing. Somebody who reads the table therefore holds a value that
 * hashes to something else, and posting it is refused like any other wrong
 * code. That is the property the license registry's token hash has too, and it
 * is the one worth keeping: read access to the table is not credential access.
 */

import { createHash, randomInt } from "node:crypto";

/**
 * The alphabet a person can read off a screen and type back.
 *
 * Crockford's base32 without I, L, O and U: the first three are read as 1 and
 * 0, and the fourth is dropped so no code spells a word somebody has to say
 * out loud.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Four groups of four, which is short enough to read and dictate. */
const GROUPS = 4;
const GROUP_LENGTH = 4;

/** Everything that is decoration rather than code: spaces, dashes, the prefix. */
const DECORATION = /[\s-]+/g;

export const ACTIVATION_CODE_PREFIX = "LW";

/** A normalised code: the prefix and sixteen characters of the alphabet. */
const NORMALISED_SHAPE = new RegExp(
  `^${ACTIVATION_CODE_PREFIX}[${ALPHABET}]{${GROUPS * GROUP_LENGTH}}$`,
);

/**
 * A fresh code, as it is shown to the operator once and never again.
 *
 * Sixteen characters of a 32 symbol alphabet is eighty bits, which is far past
 * anything the rate limiter would let a caller work through, and the limiter is
 * what actually bounds guessing.
 */
export function mintActivationCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group++) {
    let text = "";
    for (let index = 0; index < GROUP_LENGTH; index++) {
      text += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(text);
  }
  return `${ACTIVATION_CODE_PREFIX}-${groups.join("-")}`;
}

/**
 * A code as typed, reduced to what it means.
 *
 * Case, spaces and dashes are decoration: a customer pasting `lw-a1b2 c3d4...`
 * out of an email has typed the same code as one reading it off a slide.
 */
export function normaliseActivationCode(code: string): string | null {
  const stripped = code.trim().replace(DECORATION, "").toUpperCase();
  return NORMALISED_SHAPE.test(stripped) ? stripped : null;
}

/** Whether a presented value could be a code at all. */
export function isActivationCodeShape(code: string): boolean {
  return normaliseActivationCode(code) !== null;
}

/**
 * What the registry stores and looks a code up by.
 *
 * Over the normalised code, so the stored value is a step away from anything a
 * caller could present.
 */
export function activationCodeHash(normalisedCode: string): string {
  return createHash("sha256").update(normalisedCode).digest("hex");
}

/**
 * The last four characters, which is how an operator tells two codes apart in a
 * list without the list holding either one.
 */
export function activationCodeHint(normalisedCode: string): string {
  return normalisedCode.slice(-GROUP_LENGTH);
}
