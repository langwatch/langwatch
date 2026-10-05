/**
 * What an activation code looks like (ADR-141, section 5).
 *
 * Pure and free of Node built-ins, so the License page in the browser and the
 * server read a pasted value with the same rule. Minting and hashing live in
 * `activationCode.ts`.
 */

/**
 * The alphabet a person can read off a screen and type back.
 *
 * Crockford's base32 without I, L, O and U: the first three are read as 1 and
 * 0, and the fourth is dropped so no code spells a word a customer would rather
 * not read back over the phone.
 */
export const ACTIVATION_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Four groups of four, which is short enough to read and dictate. */
export const ACTIVATION_CODE_GROUPS = 4;
export const ACTIVATION_CODE_GROUP_LENGTH = 4;

export const ACTIVATION_CODE_PREFIX = "LW";

/** Everything that is decoration rather than code: spaces, dashes, the prefix. */
const DECORATION = /[\s-]+/g;

/** A normalised code: the prefix and sixteen characters of the alphabet. */
const NORMALISED_SHAPE = new RegExp(
  `^${ACTIVATION_CODE_PREFIX}[${ACTIVATION_CODE_ALPHABET}]{${
    ACTIVATION_CODE_GROUPS * ACTIVATION_CODE_GROUP_LENGTH
  }}$`,
);

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
