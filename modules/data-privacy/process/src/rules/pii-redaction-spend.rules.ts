/**
 * What one PII redaction model call costs the customer and us, and the request id it is billed
 * under (ADR-201). Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import { createHmac } from "node:crypto";

import {
  PII_REDACTION_NANO_USD_PER_CHARACTER,
  PII_REDACTION_RATE_VERSION,
  PII_REDACTION_SPEND_MODEL,
  type PiiRedactionSpendPricedEventData,
} from "@langwatch/data-privacy-contract/pii-redaction-spend";

import { batchCharactersOf } from "./pii-redaction-model.rules.ts";

/** The model's Lambda memory, in GB, which its duration is billed by. */
const MODEL_MEMORY_GB = 7;

/** AWS list price for arm64 Lambda duration, per GB-second, in nano-USD. */
const NANO_USD_PER_GB_SECOND = 13_333.4;

/** AWS list price per Lambda request, in nano-USD (0.20 dollars per million). */
const NANO_USD_PER_REQUEST = 200;

const REQUEST_ID_PREFIX = "piiredaction_";

/** What the request-id key is derived under, so it never equals the key pepper itself. */
const REQUEST_ID_KEY_LABEL = "pii-redaction-request-id";

/**
 * The request-id key: an HMAC of this label under the deployment's key pepper. A key of its own,
 * so a request id never yields a hash made under the secret api-key hashes keys with.
 */
export function piiRedactionRequestIdKey(keyPepper: string): Uint8Array {
  return createHmac("sha256", keyPepper).update(REQUEST_ID_KEY_LABEL).digest();
}

export function piiRedactionPriceNanoUsd({
  characters,
  free,
}: {
  characters: number;
  free: boolean;
}): number {
  return free ? 0 : characters * PII_REDACTION_NANO_USD_PER_CHARACTER;
}

/** Our estimated cost of one call: Lambda duration at 7 GB plus the request fee, no warmer. */
export function piiRedactionCostNanoUsd({ durationMs }: { durationMs: number }): number {
  const gbSeconds = (MODEL_MEMORY_GB * durationMs) / 1_000;
  return Math.round(gbSeconds * NANO_USD_PER_GB_SECOND) + NANO_USD_PER_REQUEST;
}

/**
 * An HMAC of the project, the record's own key when it has one, and the texts, each
 * length-prefixed. Keyed, so the stored id is no commitment to the text: a short value such as a
 * phone number cannot be confirmed by hashing guesses without the deployment's key (ADR-201).
 */
export function piiRedactionSpendRequestId({
  key,
  projectId,
  recordKey,
  texts,
}: {
  key: Uint8Array;
  projectId: string;
  recordKey?: string | undefined;
  texts: readonly string[];
}): string {
  const hmac = createHmac("sha256", key);
  for (const part of [projectId, recordKey ?? "", ...texts]) {
    hmac.update(`${part.length}:${part}`);
  }
  return `${REQUEST_ID_PREFIX}${hmac.digest("hex").slice(0, 32)}`;
}

export function piiRedactionSpendFact({
  key,
  organizationId,
  projectId,
  texts,
  recordKey,
  durationMs,
  free,
  occurredAt,
}: {
  key: Uint8Array;
  organizationId: string;
  projectId: string;
  texts: readonly string[];
  recordKey?: string | undefined;
  durationMs: number;
  free: boolean;
  occurredAt: number;
}): PiiRedactionSpendPricedEventData {
  const characters = batchCharactersOf(texts);
  return {
    tenantId: organizationId,
    occurredAt,
    organizationId,
    projectId,
    requestId: piiRedactionSpendRequestId({ key, projectId, recordKey, texts }),
    model: PII_REDACTION_SPEND_MODEL,
    rateVersion: PII_REDACTION_RATE_VERSION,
    characters,
    texts: texts.length,
    priceNanoUsd: piiRedactionPriceNanoUsd({ characters, free }),
    costNanoUsd: piiRedactionCostNanoUsd({ durationMs }),
  };
}
