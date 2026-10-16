/**
 * The tokens that can only ask for a testing licence (ADR-180 section 2). Pure, shared by the
 * door and the ops console. The table stores the token's SHA-256, never the token.
 */

import { createHash, randomBytes } from "node:crypto";

import type { TestingLicenseTokenStatus } from "@langwatch/enterprise-licensing-contract";
import { Temporal, type Instant } from "@langwatch/time";

/** What a presented bearer starts with, so a licence token or API key is told apart at once. */
export const TESTING_LICENSE_TOKEN_PREFIX = "lwtl_";

/** The kind prefix of a token row's id. */
export const TESTING_LICENSE_TOKEN_KSUID_RESOURCE = "testingtoken";

/** A personal token lasts as long as a CLI sign-in's refresh token; then its person signs in. */
export const PERSONAL_TOKEN_LIFETIME_DAYS = 90;

/** A service token expires in 90 days unless asked otherwise, and within a year at most. */
export const SERVICE_TOKEN_DEFAULT_DAYS = 90;
export const SERVICE_TOKEN_MAX_DAYS = 365;

/** Thirty-two random bytes: far past guessing, so no rate limit is what protects it. */
export function mintTestingLicenseToken(): string {
  return `${TESTING_LICENSE_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** What the table stores and looks a presented token up by. */
export function testingLicenseTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A bearer that could be a testing-licence token; anything else is refused unread. */
export function isTestingLicenseTokenShaped(bearer: string | null): bearer is string {
  return bearer !== null && bearer.startsWith(TESTING_LICENSE_TOKEN_PREFIX) && bearer.length < 256;
}

/** Revoked wins over the token's own term. */
export function statusOfTestingLicenseToken(
  row: Readonly<{ revokedAt: Instant | null; expiresAt: Instant }>,
  now: Instant,
): TestingLicenseTokenStatus {
  if (row.revokedAt) return "revoked";
  if (Temporal.Instant.compare(now, row.expiresAt) >= 0) return "expired";
  return "active";
}

/** When a token minted now runs out, `days` from now. */
export function testingLicenseTokenExpiry({ now, days }: { now: Instant; days: number }): Instant {
  return now.add({ hours: days * 24 });
}
