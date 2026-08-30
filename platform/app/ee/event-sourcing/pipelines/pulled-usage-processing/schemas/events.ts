// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { z } from "zod";

import { EventSchema } from "~/server/event-sourcing/domain/types";
import {
  PULLED_USAGE_COST_BASIS,
  PULLED_USAGE_COST_STATUS,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
} from "./constants";

/**
 * `PulledUsageObserved` — one priced usage item pulled from a provider's own
 * record of what the customer already spent (ADR-088, Schema).
 *
 * Time carries two fields and they are not interchangeable. `occurredAtMs` is
 * the provider's business bucket — the day or hour the spend belongs to, which
 * a restatement of that same period keeps unchanged. `observedAtMs` is the
 * monotonic instant we pulled it, and it is the ONLY field a restatement can be
 * ordered by; ordering versions by the bucket time would compare a period
 * against itself. Both are epoch milliseconds and neither is named
 * `occurredAt`, because that is a command-envelope field `stripEnvelope` would
 * delete from the event data before it was ever stored.
 */
export const pulledUsageObservedEventDataSchema = z.object({
  /**
   * The provider's stable natural key for this item: the bucket coordinates
   * for an admin API that reports periods, or the message id for a provider
   * that reports messages. Human-readable; carried for support and debugging.
   */
  itemKey: z.string().min(1),
  /**
   * The dimension-only identity a restatement matches on. Cost and quantities
   * are EXCLUDED by construction: hashing the cost in would make a corrected
   * figure mint a fresh key and be added on top of the figure it corrects.
   */
  restatementKey: z.string().min(1),
  /** Which provider record this came from, e.g. `anthropic_admin`. */
  source: z.string().min(1),
  /** The ingestion source's id — the row that owns the attribution below. */
  ingestionSourceId: z.string().min(1),

  /** Attribution, read off the IngestionSource, never inferred. */
  organizationId: z.string().min(1),
  /** Null when the source names no team: unattributed, said out loud. */
  teamId: z.string().nullable(),
  /**
   * The row's storage home: the org's hidden governance project (ADR-128).
   * Not attribution — who the money belongs to is organizationId/teamId
   * above. Members never see the home; every listing surface excludes
   * kind="internal_governance".
   *
   * Stays nullable for the events already on the durable log, which were
   * written before there was a home to name. Nothing minted since carries
   * null.
   */
  projectId: z.string().nullable(),

  model: z.string(),
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  tokensCacheRead: z.number().int().nonnegative(),
  tokensCacheWrite: z.number().int().nonnegative(),

  /**
   * The money, priced exactly once at the ingest seam, as an integer of the
   * provider's own MINOR units — nano-euros for a subscription billed in
   * euros, nano-dollars for one billed in dollars. Which of those it is, is
   * `currencyCode` below and nowhere else; nothing here converts.
   *
   * SIGNED, unlike the token counts above. A provider that refunds or credits
   * a period reports it as a negative figure in the same field a charge
   * arrives in, and the credit has to reach the ledger or the charge it
   * reverses stands alone. A negative token count, by contrast, is not
   * something that happened, so those stay nonnegative.
   */
  costNanoMinor: z.number().int(),
  /**
   * Which currency `costNanoMinor` is denominated in, ISO 4217.
   *
   * Defaulted rather than required, and the default is load-bearing: every
   * event already on the durable log was written before money carried a
   * currency, and every one of those producers reported dollars. A required
   * field here would make the append-only log unreadable, which is a rebuild
   * rather than a migration (ADR-128 §3).
   */
  currencyCode: z.string().length(3).default("USD"),
  /**
   * The BILLER's own conversion of `costNanoMinor` into nano-dollars, when it
   * published one — Azure returns `totalCostUSD` beside `totalCost` at its own
   * invoice-grade rate.
   *
   * Null means no dollar figure exists for this item, and that is a different
   * fact from zero: zero charts as free usage, absent says we hold money here
   * that no dollar column can honestly state. We never invent a rate to fill
   * it, so it stays null for a non-dollar provider that published none. Null
   * on a dollars-denominated item too, where `costNanoMinor` already IS the
   * dollar figure and a copy would be a second number to keep in step.
   */
  costNanoUsd: z.number().int().nullable().default(null),
  /**
   * Which price table produced a `computed` cost. Null for
   * `provider_reported`: there was no price table, the provider said the
   * number, and stamping a rate version on it would claim we derived it.
   */
  rateVersion: z.string().nullable(),
  costBasis: z.enum([
    PULLED_USAGE_COST_BASIS.PROVIDER_REPORTED,
    PULLED_USAGE_COST_BASIS.COMPUTED,
  ]),
  costStatus: z.enum([
    PULLED_USAGE_COST_STATUS.EXACT,
    PULLED_USAGE_COST_STATUS.ESTIMATE,
  ]),

  /** The provider's business bucket time, epoch ms. Stable under restatement. */
  occurredAtMs: z.number().int().positive(),
  /** Monotonic pull time, epoch ms. The restatement ordering field. */
  observedAtMs: z.number().int().positive(),
});

export type PulledUsageObservedEventData = z.infer<
  typeof pulledUsageObservedEventDataSchema
>;

export const PulledUsageObservedEventSchema = EventSchema.extend({
  type: z.literal(PULLED_USAGE_EVENT_TYPES.OBSERVED),
  version: z.literal(PULLED_USAGE_EVENT_VERSIONS.OBSERVED),
  data: pulledUsageObservedEventDataSchema,
});

export type PulledUsageObservedEvent = z.infer<
  typeof PulledUsageObservedEventSchema
>;
export type PulledUsageProcessingEvent = PulledUsageObservedEvent;
