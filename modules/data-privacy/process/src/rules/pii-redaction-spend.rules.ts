/**
 * What one PII redaction model call costs the customer and us, and the request id it is billed
 * under (ADR-201). Spec: modules/data-privacy/specs/pii-redaction-billing.feature
 */
import { createHash } from "node:crypto";

import {
  PII_REDACTION_NANO_USD_PER_CHARACTER,
  PII_REDACTION_RATE_VERSION,
  PII_REDACTION_SPEND_MODEL,
  type PiiRedactionSpendPricedEventData,
} from "@langwatch/data-privacy-contract";

import { batchCharactersOf } from "./pii-redaction-model.rules.ts";

/** The model's Lambda memory, in GB, which its duration is billed by. */
const MODEL_MEMORY_GB = 7;

/** AWS list price for arm64 Lambda duration, per GB-second, in nano-USD. */
const NANO_USD_PER_GB_SECOND = 13_333.4;

/** AWS list price per Lambda request, in nano-USD (0.20 dollars per million). */
const NANO_USD_PER_REQUEST = 200;

const REQUEST_ID_PREFIX = "piiredaction_";

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

/** The project, the record's own key when it has one, and the texts, each length-prefixed. */
export function piiRedactionSpendRequestId({
  projectId,
  recordKey,
  texts,
}: {
  projectId: string;
  recordKey?: string | undefined;
  texts: readonly string[];
}): string {
  const hash = createHash("sha256");
  for (const part of [projectId, recordKey ?? "", ...texts]) {
    hash.update(`${part.length}:${part}`);
  }
  return `${REQUEST_ID_PREFIX}${hash.digest("hex").slice(0, 32)}`;
}

export function piiRedactionSpendFact({
  organizationId,
  projectId,
  texts,
  recordKey,
  durationMs,
  free,
  occurredAt,
}: {
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
    requestId: piiRedactionSpendRequestId({ projectId, recordKey, texts }),
    model: PII_REDACTION_SPEND_MODEL,
    rateVersion: PII_REDACTION_RATE_VERSION,
    characters,
    texts: texts.length,
    priceNanoUsd: piiRedactionPriceNanoUsd({ characters, free }),
    costNanoUsd: piiRedactionCostNanoUsd({ durationMs }),
  };
}
