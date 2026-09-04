// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Freshness and authenticity for the Auth0 SCIM webhook, in the header shape
 * `packages/egress/src/webhook/signature.ts` already publishes:
 *
 *   X-LangWatch-Signature: t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<body>">
 *
 * Verified over the RAW bytes, compared in constant time, and rejected outside
 * the tolerance window so a captured delivery stops replaying on a known clock.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const SCIM_WEBHOOK_SIGNATURE_HEADER = "x-langwatch-signature";

/** Receiver-side freshness window; the same five minutes egress publishes. */
export const SCIM_WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

export type ScimWebhookSignatureVerdict =
  | { readonly verified: true; readonly nonce: string }
  | { readonly verified: false };

/** Constant-time equality over two hex digests, length-safe. */
function digestsMatch(expected: string, candidate: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(candidate, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

function parseSignatureHeader(header: string): {
  timestamp: number | undefined;
  candidates: string[];
} {
  let timestamp: number | undefined;
  const candidates: string[] = [];
  for (const piece of header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq <= 0) continue;
    const key = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (key === "t") timestamp = Number(value);
    else if (key === "v1") candidates.push(value);
  }
  return { timestamp, candidates };
}

/**
 * The verdict for one delivery, and the nonce a caller de-duplicates on.
 *
 * Every candidate is compared even after a match, so the work does not depend
 * on WHICH signature matched during a secret rotation.
 */
export function verifyScimWebhookSignature(input: {
  secret: string;
  body: string;
  header: string | undefined;
  nowSeconds: number;
  toleranceSeconds?: number;
}): ScimWebhookSignatureVerdict {
  if (!input.header) return { verified: false };
  const tolerance = input.toleranceSeconds ?? SCIM_WEBHOOK_TOLERANCE_SECONDS;
  const { timestamp, candidates } = parseSignatureHeader(input.header);
  if (timestamp === void 0 || !Number.isFinite(timestamp)) return { verified: false };
  if (candidates.length === 0) return { verified: false };
  if (Math.abs(input.nowSeconds - timestamp) > tolerance) return { verified: false };

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.${input.body}`)
    .digest("hex");
  let matched = false;
  for (const candidate of candidates) {
    if (digestsMatch(expected, candidate)) matched = true;
  }
  return matched ? { verified: true, nonce: `${timestamp}.${expected}` } : { verified: false };
}
