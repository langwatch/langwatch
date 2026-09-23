/**
 * The short code a fresh install pastes instead of a license blob (ADR-156 section 5). Pure, shared
 * by backoffice and connect host. The registry stores the code's SHA-256, never the code.
 */

import { createHash, randomInt } from "node:crypto";

import type { ActivationCodeStatus } from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

/**
 * The alphabet a person can read off a screen and type back: Crockford's
 * base32 without I, L, O and U — the first three read as 1 and 0, and the
 * fourth is dropped so no code spells a word worth not reading over the phone.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Four groups of four, which is short enough to read and dictate. */
const GROUPS = 4;
const GROUP_LENGTH = 4;

/** Everything that is decoration rather than code: spaces and dashes. */
const DECORATION = /[\s-]+/g;

export const ACTIVATION_CODE_PREFIX = "LW";

/** A normalised code: the prefix and sixteen characters of the alphabet. */
const NORMALISED_SHAPE = new RegExp(
  `^${ACTIVATION_CODE_PREFIX}[${ALPHABET}]{${GROUPS * GROUP_LENGTH}}$`,
);

/**
 * A fresh code, as it is shown to the operator once and never again. Sixteen characters of a 32
 * symbol alphabet is eighty bits, far past anything the rate limiter would let a caller work
 * through, and the limiter is what actually bounds guessing.
 */
export function mintActivationCode(): string {
  const groups: string[] = [];
  for (let group = 0; group < GROUPS; group += 1) {
    let text = "";
    for (let index = 0; index < GROUP_LENGTH; index += 1) {
      text += ALPHABET[randomInt(ALPHABET.length)];
    }
    groups.push(text);
  }
  return `${ACTIVATION_CODE_PREFIX}-${groups.join("-")}`;
}

/**
 * A code as typed, reduced to what it means: case, spaces and dashes are
 * decoration, so a pasted code and a dictated one are the same code.
 */
export function normaliseActivationCode(code: string): string | null {
  const stripped = code.trim().replace(DECORATION, "").toUpperCase();
  return NORMALISED_SHAPE.test(stripped) ? stripped : null;
}

/** Whether a presented value could be a code at all. */
export function isActivationCodeShape(code: string): boolean {
  return normaliseActivationCode(code) !== null;
}

/** What the registry stores and looks a code up by, over the normalised code. */
export function activationCodeHash(normalisedCode: string): string {
  return createHash("sha256").update(normalisedCode).digest("hex");
}

/**
 * The last four characters, which is how an operator tells two codes apart in
 * a list without the list holding either one.
 */
export function activationCodeHint(normalisedCode: string): string {
  return normalisedCode.slice(-GROUP_LENGTH);
}

/** Revoked wins over redeemed, which wins over the code's own term. */
export function statusOfActivationCode(
  row: Readonly<{
    revokedAt: Instant | null;
    reusable: boolean;
    redeemedAt: Instant | null;
    expiresAt: Instant;
  }>,
  now: Instant,
): ActivationCodeStatus {
  if (row.revokedAt) return "revoked";
  if (!row.reusable && row.redeemedAt) return "redeemed";
  if (Temporal.Instant.compare(now, row.expiresAt) >= 0) return "expired";
  return "active";
}
