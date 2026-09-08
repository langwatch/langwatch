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
 * The observation key — what makes one pull of one bucket a distinct fact.
 *
 * This is the OTHER half of the two-key split, and the split is the whole
 * correction mechanic. The restatement key (the aggregate id, and the ledger's
 * replace identity) is dimension-only: it is what a correction must MATCH.
 * This key is content-inclusive: it is what a correction must DIFFER on, or
 * the command boundary drops the correction before the ledger ever sees it.
 *
 * `observedAtMs` is in here, and it is not decoration. Without it, a provider
 * that restates a bucket $10 → $12 → $10 produces, on the third pull, the same
 * content key as the first, gets deduped at the command boundary, and the
 * ledger keeps reporting $12 forever. A revert IS a correction, and money that
 * silently refuses to go back down is the worst shape this bug could take.
 *
 * The cost of including it: an unchanged re-pull appends an event rather than
 * being a no-op here. That is bounded — the puller's watermark advances past a
 * drained bucket, so only the newest window is ever re-read — and it is what
 * an event log should hold anyway, since observing the same bucket twice IS
 * two observations. The no-op the spec asks for is about recorded COST, and it
 * is kept where the money lives: `insertPulledUsageRows` skips the write when
 * the amount and the quantities are unchanged, so an unchanged re-pull moves
 * no money and adds no ledger row.
 */
function pulledUsageObservationKey(data: PulledUsageObservedEventData): string {
  return [
    data.restatementKey,
    data.costNanoUsd,
    data.tokensInput,
    data.tokensOutput,
    data.tokensCacheRead,
    data.tokensCacheWrite,
    data.costBasis,
    data.costStatus,
    data.observedAtMs,
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
  idempotencyKey: (data) => pulledUsageObservationKey(data),
  spanAttributes: (data) => ({
    "payload.source": data.source,
    "payload.ingestion_source_id": data.ingestionSourceId,
    "payload.cost_basis": data.costBasis,
    "payload.cost_status": data.costStatus,
    "payload.cost_nano_usd": data.costNanoUsd,
  }),
  makeJobId: (data) => pulledUsageObservationKey(data),
});
