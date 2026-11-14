import { createHash } from "node:crypto";

import { EventUtils } from "@langwatch/eventing";
import { getEnvironment, Instance, Ksuid, type KsuidLayout } from "@langwatch/ksuid";

const TRACE_SUMMARY_RESOURCE = "tracesummary";

/**
 * The trace_summaries projection's deterministic KSUID identity, in the byte
 * layout the stored row was written with (#9575).
 */
export function createTraceSummaryProjectionId(input: {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
  layout: KsuidLayout;
}): string {
  EventUtils.validateTenantId({ tenantId: input.tenantId }, "createTraceSummaryProjectionId");

  const hash = createHash("sha256")
    .update(`${input.tenantId}:${input.traceId}`)
    .update(":")
    .update(String(input.occurredAtMs))
    .digest();
  const instance = new Instance(Instance.schemes.RANDOM, new Uint8Array(hash.subarray(0, 8)));
  const sequence = ((hash[8]! << 24) | (hash[9]! << 16) | (hash[10]! << 8) | hash[11]!) >>> 0;

  const timestamp = Math.floor(input.occurredAtMs / 1000);
  return new Ksuid({
    environment: getEnvironment(),
    resource: TRACE_SUMMARY_RESOURCE,
    timestamp,
    instance,
    sequenceId: sequence,
    layout: input.layout,
  }).toString();
}
