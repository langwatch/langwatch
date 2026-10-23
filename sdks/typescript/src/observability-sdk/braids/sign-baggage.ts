/**
 * Signs named baggage entries for a braid's signed calls, wire format v1 of
 * ADR-185 section 4 (dev/docs/adr/185-braids-show-matching-spans-in-another-projects-traces.md).
 * @module braids/sign-baggage
 */

import { createHmac } from "node:crypto";

import { context as otelContext, propagation, trace, type Context } from "@opentelemetry/api";

import {
  assertBraidEntryKey,
  BRAID_SIGNATURE_DOMAIN,
  BRAID_SIGNATURE_KEY,
  BraidSigningError,
} from "./braid-wire-format";

const SIGNING_KEY_PREFIX = "lwsk_";
const PUBLIC_ID_PATTERN = /^[A-Za-z0-9]+$/;

function publicIdOf(signingKey: string): string {
  const rest = signingKey.startsWith(SIGNING_KEY_PREFIX)
    ? signingKey.slice(SIGNING_KEY_PREFIX.length)
    : "";
  const separator = rest.indexOf("_");
  const publicId = rest.slice(0, Math.max(separator, 0));
  if (separator <= 0 || separator === rest.length - 1 || !PUBLIC_ID_PATTERN.test(publicId)) {
    throw new BraidSigningError(
      "malformed_signing_key",
      "Signing key must have the form lwsk_<publicId>_<secret>, publicId in [A-Za-z0-9]",
    );
  }
  return publicId;
}

/**
 * The `langwatch.signature` value for these entries in this trace. Pure: the
 * pinned test vector in every SDK asserts this exact string.
 */
export function computeBraidSignature({
  signingKey,
  traceId,
  entries,
}: {
  signingKey: string;
  traceId: string;
  entries: Record<string, string>;
}): string {
  const kid = publicIdOf(signingKey);
  const keys = Object.keys(entries);
  if (keys.length === 0) {
    throw new BraidSigningError("empty_entries", "A braid signature needs at least one entry");
  }
  for (const key of keys) {
    assertBraidEntryKey(key);
    const value = entries[key];
    if (typeof value !== "string" || /[\r\n]/.test(value)) {
      throw new BraidSigningError(
        "invalid_entry_value",
        `Braid entry ${key} must be a string without line breaks`,
      );
    }
  }
  // Keys are ASCII by the pattern, so UTF-16 order is code-point order.
  keys.sort();
  const message = [
    BRAID_SIGNATURE_DOMAIN,
    traceId.toLowerCase(),
    ...keys.map((key) => `${key}=${entries[key]}`),
  ].join("\n");
  const sig = createHmac("sha256", Buffer.from(signingKey, "utf8"))
    .update(message, "utf8")
    .digest("base64url");
  const envelope = JSON.stringify({ v: 1, kid, keys, sig });
  return Buffer.from(envelope, "utf8").toString("base64url");
}

/**
 * Puts each entry in baggage under its own key, plus `langwatch.signature`
 * over the context's trace id. Returns the new context; the active span's
 * trace is used when no context is given.
 */
export function signBaggage({
  signingKey,
  entries,
  context,
}: {
  signingKey: string;
  entries: Record<string, string>;
  context?: Context;
}): Context {
  const ctx = context ?? otelContext.active();
  const spanContext = trace.getSpanContext(ctx);
  if (!spanContext || !trace.isSpanContextValid(spanContext)) {
    throw new BraidSigningError(
      "no_active_trace",
      "signBaggage needs a context holding a valid span: the signature covers its trace id",
    );
  }
  const signature = computeBraidSignature({
    signingKey,
    traceId: spanContext.traceId,
    entries,
  });
  let baggage = propagation.getBaggage(ctx) ?? propagation.createBaggage();
  for (const [key, value] of Object.entries(entries)) {
    baggage = baggage.setEntry(key, { value });
  }
  baggage = baggage.setEntry(BRAID_SIGNATURE_KEY, { value: signature });
  return propagation.setBaggage(ctx, baggage);
}

/** Runs `fn` with the entries signed into the active context's baggage. */
export function withSignedBaggage<T>(
  { signingKey, entries }: { signingKey: string; entries: Record<string, string> },
  fn: () => T,
): T {
  return otelContext.with(signBaggage({ signingKey, entries }), fn);
}
