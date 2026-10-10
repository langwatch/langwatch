/**
 * The short code a fresh install pastes instead of a license blob (ADR-141,
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
import {
  ACTIVATION_CODE_PREFIX,
  ACTIVATION_CODE_ALPHABET as ALPHABET,
  ACTIVATION_CODE_GROUP_LENGTH as GROUP_LENGTH,
  ACTIVATION_CODE_GROUPS as GROUPS,
} from "./activationCodeShape";

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
