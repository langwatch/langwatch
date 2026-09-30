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
  type PulledUsageRetractedEventData,
  pulledUsageObservedEventDataSchema,
  pulledUsageRetractedEventDataSchema,
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
    data.costNanoMinor,
    // Both, and both matter. A provider that re-denominates a period or lands
    // its dollar conversion later has changed the record without changing the
    // native amount, and a key blind to either would dedup that correction
    // away as an unchanged re-pull.
    data.currencyCode,
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
 * The retraction key — what makes one withdrawal a distinct fact.
 *
 * Prefixed, and the prefix is the point. `findCostEventsForDay` collapses the
 * day's events on `(TenantId, AggregateType, AggregateId, IdempotencyKey)`,
 * and a retraction shares its aggregate id with every observation of the same
 * charge. A key that could collide with an observation's would let one of the
 * two silently replace the other in the comparator's read of the day; the
 * literal makes that impossible by construction rather than by luck.
 *
 * The rest is the RETRACTED cell's address plus the observation instant that
 * superseded it. Address, because two different cells of one charge are two
 * different withdrawals; instant, because a charge corrected twice must
 * withdraw twice. Re-delivering the same superseding observation reproduces
 * the same key and is dropped here, which is what keeps an at-least-once
 * outbox from filing the one withdrawal twice.
 */
function pulledUsageRetractionKey(data: PulledUsageRetractedEventData): string {
  return [
    "retract",
    data.restatementKey,
    data.currencyCode,
    data.agentId,
    data.rawActorId,
    data.model,
    data.observedAtMs,
  ].join(":");
}

/**
 * Withdraws the version of a charge that a later pull superseded.
 *
 * Same `aggregateId` as the observation it corrects — the restatement key —
 * because the fold has to see the withdrawal and the charge on one ordered
 * stream. A retraction on its own stream would be applied against whatever
 * the projection happened to hold at the time, which is the race the single
 * stream exists to remove.
 */
export const RetractPulledUsageCommand = defineCommand({
  commandType: PULLED_USAGE_COMMAND_TYPES.RETRACT,
  eventType: PULLED_USAGE_EVENT_TYPES.RETRACTED,
  eventVersion: PULLED_USAGE_EVENT_VERSIONS.RETRACTED,
  aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
  schema: pulledUsageRetractedEventDataSchema,
  aggregateId: (data) => data.restatementKey,
  idempotencyKey: (data) => pulledUsageRetractionKey(data),
  spanAttributes: (data) => ({
    "payload.source": data.source,
    "payload.ingestion_source_id": data.ingestionSourceId,
    "payload.currency_code": data.currencyCode,
    "payload.retracted_model": data.model,
  }),
  makeJobId: (data) => pulledUsageRetractionKey(data),
});

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
    "payload.cost_nano_minor": data.costNanoMinor,
    "payload.currency_code": data.currencyCode,
  }),
  makeJobId: (data) => pulledUsageObservationKey(data),
});
