import { validateTenantId } from "@langwatch/clickhouse";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { createHash } from "crypto";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Deterministic row ids: the same span or trace always hashes to the same
 * KSUID, which is what lets a redelivery collapse on merge instead of
 * inserting a second row.
 */
function makeDeterministicKsuid({
  hashKey,
  resource,
  timestampMs,
}: {
  hashKey: string;
  resource: string;
  timestampMs: number;
}): string {
  // The full millisecond timestamp is hashed in too, so the Instance and
  // sequence parts stay unique for two keys landing in the same second.
  const hash = createHash("sha256")
    .update(hashKey)
    .update(":")
    .update(String(timestampMs))
    .digest();

  const instance = new Instance(
    Instance.schemes.RANDOM,
    new Uint8Array(hash.subarray(0, 8)),
  );

  const sequence =
    ((hash[8]! << 24) | (hash[9]! << 16) | (hash[10]! << 8) | hash[11]!) >>> 0;

  return new Ksuid(
    getEnvironment(),
    resource,
    Math.floor(timestampMs / 1000),
    instance,
    sequence,
  ).toString();
}

export function generateDeterministicSpanRecordId({
  tenantId,
  traceId,
  spanId,
  startTimeUnixMs,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  startTimeUnixMs: number;
}): string {
  validateTenantId({ tenantId }, "generateDeterministicSpanRecordId");
  return makeDeterministicKsuid({
    hashKey: `${tenantId}:${traceId}:${spanId}`,
    resource: KSUID_RESOURCES.SPAN,
    timestampMs: startTimeUnixMs,
  });
}

export function generateDeterministicTraceSummaryId({
  tenantId,
  traceId,
  startTimeUnixMs,
}: {
  tenantId: string;
  traceId: string;
  startTimeUnixMs: number;
}): string {
  validateTenantId({ tenantId }, "generateDeterministicTraceSummaryId");
  return makeDeterministicKsuid({
    hashKey: `${tenantId}:${traceId}`,
    resource: KSUID_RESOURCES.TRACE_SUMMARY,
    timestampMs: startTimeUnixMs,
  });
}
