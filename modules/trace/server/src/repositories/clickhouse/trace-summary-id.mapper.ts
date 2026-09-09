import { EventUtils } from "@langwatch/eventing";
import { getEnvironment, Instance, Ksuid } from "@langwatch/ksuid";
import { createHash } from "node:crypto";

const TRACE_SUMMARY_RESOURCE = "tracesummary";

/** Preserves the trace_summaries projection's deterministic KSUID identity. */
export function createTraceSummaryProjectionId(input: {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
}): string {
  EventUtils.validateTenantId({ tenantId: input.tenantId }, "createTraceSummaryProjectionId");

  const hash = createHash("sha256")
    .update(`${input.tenantId}:${input.traceId}`)
    .update(":")
    .update(String(input.occurredAtMs))
    .digest();
  const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(hash.subarray(0, 8)));
  const sequence = ((hash[8]! << 24) | (hash[9]! << 16) | (hash[10]! << 8) | hash[11]!) >>> 0;

  return new Ksuid(
    getEnvironment(),
    TRACE_SUMMARY_RESOURCE,
    Math.floor(input.occurredAtMs / 1000),
    instance,
    sequence,
  ).toString();
}
