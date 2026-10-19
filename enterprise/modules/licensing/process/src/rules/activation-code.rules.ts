/**
 * The short code a fresh install pastes instead of a license blob (ADR-156 section 5). Pure, shared
 * by backoffice and connect host. The registry stores the code's SHA-256, never the code.
 */

import { createHash, randomInt } from "node:crypto";

import {
  ACTIVATION_CODE_ALPHABET as ALPHABET,
  ACTIVATION_CODE_GROUP_LENGTH as GROUP_LENGTH,
  ACTIVATION_CODE_GROUPS as GROUPS,
  ACTIVATION_CODE_PREFIX,
  type ActivationCodeStatus,
  detectLicenseInputForm,
} from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

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

/** A code as typed, reduced to what it means (see `detectLicenseInputForm`). */
export function normaliseActivationCode(code: string): string | null {
  const input = detectLicenseInputForm(code);
  return input.form === "activation_code" ? input.code : null;
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

/**
 * Guessing bound, as main set it: a code is eighty bits, so the limit is not what stops a
 * search, but what stops one costing anything. Generous for a customer mistyping twice.
 */
export const ACTIVATION_ATTEMPTS_LIMIT = { requests: 10, seconds: 60 * 60 } as const;
