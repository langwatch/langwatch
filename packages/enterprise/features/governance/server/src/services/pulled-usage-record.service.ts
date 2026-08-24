// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The ingest seam: one adapter event in, one priced usage record out
 * (ADR-088 Decisions 1, 2, 4 and 5).
 *
 * This lives with the pullers rather than with the pipeline on purpose. The
 * pipeline is provider-agnostic and must stay that way; knowing what an
 * adapter puts in `NormalizedPullEvent.extra` is exactly the adapter-shaped
 * knowledge that belongs at the boundary.
 *
 * Most pulled events are audit records with no money in them, so declaring a
 * usage item is opt-in: an adapter that has one attaches a `pulled_usage` hint
 * to `extra`, and everything else returns null and stays audit-only.
 */

import { createHash } from "node:crypto";
import {
  PULLED_USAGE_COST_BASIS,
  PULLED_USAGE_HINT_KEY,
  pulledUsageHintSchema,
  type NormalizedPullEvent,
  type PulledUsageObservedEventData,
  type PulledUsageSourceAttribution,
} from "@langwatch/enterprise-governance-contract";
import type { PulledUsagePricingService } from "./pulled-usage-pricing.service";

/**
 * The dimension-only identity two versions of one bucket share.
 *
 * Cost and quantities are excluded structurally rather than by discipline:
 * this function is only ever handed coordinates, so there is no path by which
 * a money figure reaches the hash. Keys are sorted, so an adapter that lists
 * its dimensions in a different order on a later pull still matches.
 *
 * The source id is in the key because two sources pulling the same provider
 * workspace are two customers' records, and a shared key would let one
 * restate the other.
 */
function restatementKeyFor({
  sourceType,
  ingestionSourceId,
  periodStartMs,
  dimensions,
}: {
  sourceType: string;
  ingestionSourceId: string;
  periodStartMs: number;
  dimensions: Record<string, string>;
}): string {
  const coordinates = [
    ["source", sourceType],
    ["ingestionSourceId", ingestionSourceId],
    ["periodStartMs", String(periodStartMs)],
    ...Object.entries(dimensions).sort(([a], [b]) => (a < b ? -1 : 1)),
  ];
  return createHash("sha256").update(JSON.stringify(coordinates)).digest("hex");
}

/**
 * Turns one adapter event into the record the `RecordPulledUsage` command
 * takes, or null when the event carries no usage to price.
 *
 * Null and throwing mean different things and the difference is deliberate.
 * Null is "this is an audit event, there was never any money here" — the
 * normal case, and the caller moves on. A throw is "you declared usage and
 * then handed me something I cannot key or price", which is an adapter bug:
 * loud beats quietly filing a customer's money under the wrong bucket, or
 * under `now`.
 */
export class PulledUsageRecordService {
  private constructor(private readonly pricing: PulledUsagePricingService) {}

  static create(pricing: PulledUsagePricingService): PulledUsageRecordService {
    return new PulledUsageRecordService(pricing);
  }

  build({
    event,
    source,
    observedAt,
  }: {
    event: NormalizedPullEvent;
    source: PulledUsageSourceAttribution;
    observedAt: Date;
  }): PulledUsageObservedEventData | null {
    const raw = event.extra?.[PULLED_USAGE_HINT_KEY];
    if (raw === undefined || raw === null) return null;

    const hint = pulledUsageHintSchema.parse(raw);

    const occurredAtMs = Date.parse(event.event_timestamp);
    if (!Number.isFinite(occurredAtMs)) {
      throw new Error(
        `pulled usage event ${event.source_event_id} has an unparseable bucket timestamp: ${JSON.stringify(event.event_timestamp)}`,
      );
    }

    const quantities = {
      tokensInput: event.tokens_input,
      tokensOutput: event.tokens_output,
      tokensCacheRead: hint.tokensCacheRead,
      tokensCacheWrite: hint.tokensCacheWrite,
    };
    const model = hint.model ?? event.target;

    const priced =
      hint.costBasis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED
        ? this.pricing.price({
            basis: PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
            // The string when the adapter kept one, so no digit is lost to the
            // float `cost_usd` had to be to fit the canonical event shape.
            costUsd: hint.costUsd ?? event.cost_usd,
            // Present by the schema's own refinement on this branch.
            costStatus: hint.costStatus!,
          })
        : this.pricing.price({
            basis: PULLED_USAGE_COST_BASIS.COMPUTED,
            model,
            quantities,
          });

    return {
      itemKey: event.source_event_id,
      restatementKey: restatementKeyFor({
        sourceType: source.sourceType,
        ingestionSourceId: source.ingestionSourceId,
        periodStartMs: occurredAtMs,
        dimensions: hint.dimensions,
      }),
      source: source.sourceType,
      ingestionSourceId: source.ingestionSourceId,
      organizationId: source.organizationId,
      teamId: source.teamId,
      // Deferred: `IngestionSource` carries no project yet (ADR-088 Decision 4).
      // Null says unattributed. The hidden governance project every other pull
      // writer uses is not an option here — it is invisible to the customer, so
      // filing their money there would be worse than saying we do not know.
      projectId: null,
      model,
      ...quantities,
      costNanoUsd: priced.costNanoUsd,
      rateVersion: priced.rateVersion,
      costBasis: priced.costBasis,
      costStatus: priced.costStatus,
      occurredAtMs,
      observedAtMs: observedAt.getTime(),
    };
  }
}
