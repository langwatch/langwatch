/**
 * The credential a connected install presents to LangWatch-hosted services,
 * derived from the license it already holds (ADR-139).
 *
 * Pure: no environment, no database. The install derives the token to send it,
 * and LangWatch Cloud derives it to record and look up a license, so both sides
 * share this one module.
 *
 * The token is `lwl_` plus the SHA-256 of the canonical license, which is the
 * parsed `{data, signature}` re-serialized. `verifySignature` judges a license
 * on the same re-serialized payload, so a license that verifies on an install
 * yields the same token there as on Cloud, whatever line wrapping or trailing
 * whitespace it was pasted with.
 */
import { createHash } from "node:crypto";
import { parseLicenseKey } from "./validation";

export const LICENSE_TOKEN_PREFIX = "lwl_";

const LICENSE_TOKEN_SHAPE = /^lwl_[0-9a-f]{64}$/;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The token for a license key, or null when the text does not parse as a
 * license. Parsing proves shape only: a caller that needs a license LangWatch
 * signed verifies the signature itself.
 */
export function licenseTokenFromKey(licenseKey: string): string | null {
  // Base64 decoding skips line breaks, but not the spaces a copied license
  // picks up at its ends.
  const signedLicense = parseLicenseKey(licenseKey.trim());
  if (!signedLicense) return null;

  const canonical = JSON.stringify({
    data: signedLicense.data,
    signature: signedLicense.signature,
  });
  return `${LICENSE_TOKEN_PREFIX}${sha256Hex(canonical)}`;
}

/** Whether a presented credential has the shape of a license token. */
export function isLicenseTokenShape(value: string): boolean {
  return LICENSE_TOKEN_SHAPE.test(value);
}

/**
 * What the license registry stores and looks a token up by: a second hash, over
 * the whole token. The registry never holds the token, so read access to it is
 * not credential access.
 */
export function registryHashForToken(token: string): string {
  return sha256Hex(token);
}
