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
  PULLED_USAGE_COST_STATUS,
} from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import type { PulledUsageObservedEventData } from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/events";
import { pricePulledUsage } from "@ee/event-sourcing/pipelines/pulled-usage-processing/services/pulled-usage-pricing.service";
import { z } from "zod";

import type { NormalizedPullEvent } from "./pullerAdapter";

/** The key an adapter attaches its usage hint under, inside `extra`. */
export const PULLED_USAGE_HINT_KEY = "pulled_usage" as const;

/**
 * What an adapter must say to turn one of its events into a cost record.
 *
 * `dimensions` is the provider's stable natural key with the money and the
 * quantities left out — the workspace, the model, the granularity, whatever
 * the provider groups by. It is the only thing the restatement key hashes
 * (alongside the source and the period), which is what lets a corrected bucket
 * find the figure it corrects instead of landing beside it. An adapter that
 * puts a cost or a token count in here breaks that and gets a new key per
 * correction, so: dimensions only.
 */
const pulledUsageHintSchema = z
  .object({
    costBasis: z.enum([
      PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
      PULLED_USAGE_COST_BASIS.COMPUTED,
    ]),
    /**
     * Required on the provider-reported path and meaningless on the computed
     * one, because a figure we derived is never the invoice. Enforced below
     * rather than by the type, since the hint arrives as untyped JSON.
     */
    costStatus: z
      .enum([PULLED_USAGE_COST_STATUS.EXACT, PULLED_USAGE_COST_STATUS.ESTIMATE])
      .optional(),
    dimensions: z.record(z.string()).refine((d) => Object.keys(d).length > 0, {
      message: "a pulled usage hint must name at least one dimension to key on",
    }),
    /**
     * The provider's cost as the exact decimal STRING it published, when the
     * adapter has one. `NormalizedPullEvent.cost_usd` is a `number`, and an
     * invoice figure that has passed through a JS float has already lost
     * digits by the time anything downstream can care; a provider that hands
     * us a string should have every one of them survive to the ledger.
     */
    costUsd: z.string().optional(),
    /**
     * Which currency `costUsd` is in, ISO 4217. Absent means dollars, which is
     * what every adapter written before this reported.
     *
     * Deliberately NOT a dimension. `dimensions` is the restatement identity,
     * and a provider that re-denominated a period would mint a fresh key and
     * add its correction on top of the figure it corrects rather than
     * replacing it. Currency belongs with the money, not with the coordinates.
     */
    currency: z.string().length(3).optional(),
    /**
     * The BILLER's own conversion of `costUsd` into dollars, as the exact
     * decimal string it published. Azure returns this beside the native
     * amount at its own invoice-grade rate.
     *
     * Only ever the biller's number. Absent stays absent — nothing downstream
     * fills it from a rate of our own. Also not a dimension, for the same
     * reason as `currency`.
     */
    costUsdBiller: z.string().optional(),
    /** Falls back to the event's `target`, which is where models already sit. */
    model: z.string().optional(),
    tokensCacheRead: z.number().int().nonnegative().default(0),
    tokensCacheWrite: z.number().int().nonnegative().default(0),
  })
  .superRefine((hint, ctx) => {
    if (
      hint.costBasis === PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED &&
      !hint.costStatus
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        // Without the path the issue is reported against the whole hint, so an
        // adapter author reading the error cannot see which field to add.
        path: ["costStatus"],
        message:
          "a provider-reported cost must declare costStatus: only the adapter knows whether the provider's figure is the invoice or an approximation of one",
      });
    }
  });

/** The attribution a record inherits from the source that pulled it. */
export interface PulledUsageSourceAttribution {
  ingestionSourceId: string;
  /** The provider record this came from, e.g. `anthropic_admin`. */
  sourceType: string;
  organizationId: string;
  /** Null when the source is org-wide. Never substituted with anything. */
  teamId: string | null;
}

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
export function buildPulledUsageRecord({
  event,
  source,
  governanceProjectId,
  observedAt,
}: {
  event: NormalizedPullEvent;
  source: PulledUsageSourceAttribution;
  /**
   * The org's hidden governance project — where the row is STORED, not who
   * the money belongs to. Separate from `source` because attribution is what
   * the source knows and the home is what the org has.
   */
  governanceProjectId: string;
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
      ? pricePulledUsage({
          basis: PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
          // The string when the adapter kept one, so no digit is lost to the
          // float `cost_usd` had to be to fit the canonical event shape.
          costUsd: hint.costUsd ?? event.cost_usd,
          currencyCode: hint.currency,
          costUsdBiller: hint.costUsdBiller,
          // Present by the schema's own refinement on this branch.
          costStatus: hint.costStatus!,
        })
      : pricePulledUsage({
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
    // The row's home: the org's hidden governance project, the same partition
    // the OCSF audit rows and the ledger's TenantId already use. Nothing
    // pulled arrives homeless. This says where the row is STORED and not who
    // owns the money — that stays on organizationId/teamId above, which
    // `pulledUsageScopeId` reads to pick the ledger's Scope. Members never see
    // the home: every listing surface excludes kind="internal_governance".
    // Decision: ADR-128.
    projectId: governanceProjectId,
    model,
    ...quantities,
    costNanoMinor: priced.costNanoMinor,
    currencyCode: priced.currencyCode,
    costNanoUsd: priced.costNanoUsd,
    rateVersion: priced.rateVersion,
    costBasis: priced.costBasis,
    costStatus: priced.costStatus,
    occurredAtMs,
    observedAtMs: observedAt.getTime(),
  };
}
