import { createHmac } from "crypto";

/**
 * Computes an opaque, unguessable profile ID for use with external
 * tracking/CDP providers (Customer.io, PostHog, etc.).
 *
 * When `hmacSecret` is configured, returns `HMAC-SHA256(secret, userId)`
 * base64url-encoded. This prevents cross-user write attacks where an
 * attacker who knows the public CDP write key and a victim's userId
 * could call `identify("victim_id", { … })` from their own browser.
 *
 * When `hmacSecret` is absent (self-hosted deployments without the env
 * var), falls back to the raw userId for backward compatibility.
 */
export function computeExternalProfileId({
  userId,
  hmacSecret,
}: {
  userId: string;
  hmacSecret: string | undefined;
}): string {
  if (!hmacSecret) return userId;
  return createHmac("sha256", hmacSecret).update(userId).digest("base64url");
}
