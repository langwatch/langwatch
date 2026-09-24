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
  PULLED_USAGE_DEFAULT_CURRENCY_CODE,
  PULLED_USAGE_HINT_KEY,
  pulledUsageHintSchema,
  type NormalizedPullEvent,
  type PulledUsageHint,
  type PulledUsageObservedEventData,
  type PulledUsageSourceAttribution,
} from "@langwatch/enterprise-governance-contract";
import { type Instant, toEpochMs } from "@langwatch/time";

import type { PulledUsagePricingService } from "./pulled-usage-pricing.service.ts";

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
    ...Object.entries(dimensions).toSorted(([a], [b]) => (a < b ? -1 : 1)),
  ];

  return createHash("sha256").update(JSON.stringify(coordinates)).digest("hex");
}

/**
 * The provider's reported amount together with the currency that names it.
 *
 * One function returning both halves, and that is the whole point of it. The
 * homes are read in falling order of precision, and each home supplies BOTH
 * halves or neither: taking the amount from one home and the currency from
 * another is how a dollar figure ends up denominated in euros — a wrong number
 * stated with a straight face, in a column nothing downstream re-derives.
 *
 *   - The hint's own string is the exact one the adapter kept, so no digit is
 *     lost to the float `cost_usd` had to be to fit the canonical event shape.
 *     Its currency is the hint's own, and absent there means dollars.
 *   - The canonical `cost_usd` field means DOLLARS or nothing. It is never a
 *     stand-in for an amount in another currency, because nothing beside it
 *     could say otherwise.
 *
 * A third home — the event's own billed amount, named by a currency that
 * arrived beside it for exactly this purpose — exists on `origin/main` and not
 * yet here: `NormalizedPullEvent` carries no `cost_amount`/`cost_currency`
 * pair, and neither does the hint carry `currency`/`costUsdBiller`. Adding
 * them is a change to the puller contract, which is where the branches still
 * differ. Until then every adapter on this branch reports dollars, which is
 * what makes the constant below the honest answer rather than a placeholder.
 */
function deriveReportedMoney({
  hint,
  event,
}: {
  hint: PulledUsageHint;
  event: NormalizedPullEvent;
}): { amount: string; currencyCode: string } | null {
  if (hint.costUsd !== undefined) {
    return {
      amount: hint.costUsd,
      currencyCode: hint.currency ?? PULLED_USAGE_DEFAULT_CURRENCY_CODE,
    };
  }
  if (event.cost_amount !== undefined && event.cost_currency !== undefined) {
    return { amount: event.cost_amount, currencyCode: event.cost_currency };
  }
  if (event.cost_usd !== undefined) {
    return { amount: event.cost_usd, currencyCode: PULLED_USAGE_DEFAULT_CURRENCY_CODE };
  }
  return null;
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

  findBuilt({
    event,
    source,
    governanceProjectId,
    observedAt,
  }: {
    event: NormalizedPullEvent;
    source: PulledUsageSourceAttribution;
    /** Where the row is stored: the org's hidden governance project (main `pulledUsageRecord.ts:319-327`, ADR-128). */
    governanceProjectId: string;
    observedAt: Instant;
  }): PulledUsageObservedEventData | null {
    const raw = event.extra?.[PULLED_USAGE_HINT_KEY];
    if (raw === undefined || raw === null) {
      return null;
    }

    const hint = pulledUsageHintSchema.parse(raw);

    const occurredAtMs = toEpochMs(event.event_timestamp);
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

    // Both halves of the provider's figure, from one decision. Read once into
    // one binding so there is no line at which a later edit could take the
    // amount from here and the currency from somewhere else.
    const reported = deriveReportedMoney({ hint, event });
    if (hint.costBasis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED && reported === null) {
      return null;
    }

    let priced;
    if (hint.costBasis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED) {
      if (reported === null) {
        return null;
      }
      if (hint.costStatus === undefined) {
        throw new Error("provider-reported pulled usage requires costStatus");
      }
      priced = this.pricing.price({
        basis: PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
        costUsd: reported.amount,
        currencyCode: reported.currencyCode,
        costUsdBiller: hint.costUsdBiller,
        costStatus: hint.costStatus,
      });
    } else {
      priced = this.pricing.price({
        basis: PULLED_USAGE_COST_BASIS.COMPUTED,
        model,
        quantities,
      });
    }

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
      // The row's home, as main stores it: who owns the money stays on organizationId/teamId (ADR-128).
      projectId: governanceProjectId,
      model,
      ...quantities,
      // The three money fields travel as one unit, straight off the price the
      // seam produced. Never assembled from separate sources here — the amount
      // is denominated by the code beside it and by nothing else.
      costNanoMinor: priced.costNanoMinor,
      currencyCode: priced.currencyCode,
      costNanoUsd: priced.costNanoUsd,
      rateVersion: priced.rateVersion,
      costBasis: priced.costBasis,
      costStatus: priced.costStatus,
      occurredAtMs,
      observedAtMs: observedAt.epochMilliseconds,
    };
  }
}
