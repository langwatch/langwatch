// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { defineCommand } from "~/server/event-sourcing/commands/defineCommand";
import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_COMMAND_TYPES,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
} from "./schemas/constants";
import {
  type PulledUsageObservedEventData,
  pulledUsageObservedEventDataSchema,
} from "./schemas/events";

/**
 * What a re-pull has to change before it counts as a new fact.
 *
 * The aggregate is the restatement key, so every version of one usage item
 * shares a stream; this is what separates the two things a re-pull can be.
 * An unchanged re-pull produces the identical money and quantities, so it
 * produces the identical idempotency key and never appends — the no-op is
 * structural, not a downstream comparison. A corrected bucket differs in at
 * least one of these, appends, and replaces the earlier figure at the ledger.
 *
 * Cost belongs in THIS key and not in the restatement key, and the difference
 * is the whole correction mechanic: the restatement key is what a correction
 * must MATCH, the idempotency key is what it must DIFFER on.
 */
function pulledUsageContentKey(data: PulledUsageObservedEventData): string {
  return [
    data.restatementKey,
    data.costNanoUsd,
    data.tokensInput,
    data.tokensOutput,
    data.tokensCacheRead,
    data.tokensCacheWrite,
    data.costBasis,
    data.costStatus,
  ].join(":");
}

/**
 * Records one priced pulled usage item.
 *
 * `aggregateId` is the restatement key rather than the item key: two versions
 * of the same bucket have to land on one ordered stream for "newest wins" to
 * mean anything, and the item key is only a human-readable coordinate.
 */
export const RecordPulledUsageCommand = defineCommand({
  commandType: PULLED_USAGE_COMMAND_TYPES.RECORD,
  eventType: PULLED_USAGE_EVENT_TYPES.OBSERVED,
  eventVersion: PULLED_USAGE_EVENT_VERSIONS.OBSERVED,
  aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
  schema: pulledUsageObservedEventDataSchema,
  aggregateId: (data) => data.restatementKey,
  idempotencyKey: (data) => pulledUsageContentKey(data),
  spanAttributes: (data) => ({
    "payload.source": data.source,
    "payload.ingestion_source_id": data.ingestionSourceId,
    "payload.cost_basis": data.costBasis,
    "payload.cost_status": data.costStatus,
    "payload.cost_nano_usd": data.costNanoUsd,
  }),
  makeJobId: (data) => pulledUsageContentKey(data),
});
