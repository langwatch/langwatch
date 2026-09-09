// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * How the last agents listing ended, for a source, in words a screen may show.
 *
 * A NARROWING BOUNDARY, and that is the whole job. The run-status row stores
 * what happened in columns that are deliberately wider and franker than
 * anything a customer should read: the outcome is a plain `string` because the
 * log outlives the vocabulary, the refusal reason is a provider-facing code,
 * and the status column holds a raw HTTP status kept for an operator reading a
 * support ticket. This function reads those and hands back only the two facts
 * a reader can act on.
 *
 * IT NEVER TOUCHES THE STATUS COLUMN. Not narrowed, not bucketed, not passed
 * through: a tenant admin shown "403" learns that some credential somewhere
 * was refused, which is a detail about our integration rather than about their
 * data, and there is nothing they do differently for a 403 than for a 401.
 * `ee/governance/__tests__/listingOutcomePrivacy.guard.unit.test.ts` holds that
 * line two ways, and THIS FILE IS INSIDE BOTH of them rather than exempt from
 * either. It scans the whole application for the column name, so widening
 * {@link AgentsListingSummary} by one column fails it here; and it drives the
 * read behind this function against a row carrying a sentinel status, so
 * carrying that status out under some other name fails it too. The branching
 * belongs here rather than in the page because this is where the vocabulary
 * narrows, not because this side of the line is unwatched.
 *
 * THERE IS NO `empty` OUTCOME, here or in the log. A provider that answered
 * with an empty list LISTED, with a count of zero, and that is a real answer
 * about the tenant. A refusal carries no count at all and is a fact about the
 * credential. Collapsing the two is the defect this read exists to end, so
 * nothing below may invent a third outcome that blurs them again.
 *
 * Sibling of `sourcePullStatus.ts`, and narrow for the same reason: only what
 * a screen renders leaves the server, never opaque tokens or upstream error
 * bodies.
 */

import { INGESTION_PULL_LISTING_OUTCOME } from "@ee/event-sourcing/pipelines/ingestion-pull-processing/schemas/constants";
import type { IngestionPullRunProjection } from "~/generated/prisma/client";

/**
 * What a person has to DO about a refusal, which is the only reason a screen
 * branches on one at all.
 *
 * Two values rather than the seven the refusal vocabulary carries, because
 * there are two different actions and no more:
 *   `access`      — somebody has to fix a credential, a permission or a
 *                   connection's configuration. Asking again changes nothing
 *                   until they do.
 *   `unreachable` — the provider did not answer, or answered badly. Asking
 *                   again later is the action and there is nothing to fix.
 *
 * Telling a reader whose provider was rate-limited to go check their
 * credentials sends them to audit a permission that was never the problem,
 * which is why this is not one generic refusal sentence.
 */
export type AgentsListingRefusalCause = "access" | "unreachable";

/**
 * The last agents listing, or `null` when none has been recorded.
 *
 * `null` is a reading in its own right rather than a missing value: nobody has
 * asked this source yet, which is a different fact from having asked and been
 * told nothing. The refused arm carries no count, matching the log.
 */
export type AgentsListingOutcome =
  | { outcome: "listed" }
  | { outcome: "refused"; cause: AgentsListingRefusalCause };

/** The columns this decision actually reads. The status column is not one. */
export type AgentsListingSummary = Pick<
  IngestionPullRunProjection,
  "LastAgentsListingOutcome" | "LastAgentsListingReason"
>;

/**
 * Refusal reasons that mean somebody must change something before another ask
 * can work.
 *
 * `not_found` sits here rather than with the transient ones: a 404 on a
 * listing endpoint is an address that names no such collection, which is
 * configuration, and telling that reader to try again later would leave them
 * pressing a button forever.
 *
 * Everything else — including a reason this build has never heard of — falls
 * to `unreachable`, whose advice is "ask again". That is the safe default of
 * the two: it sends nobody to audit a permission that was never at fault, and
 * an unmapped reason is by definition a provider that did not behave the way
 * it documents.
 */
const ACCESS_REFUSAL_REASONS = new Set([
  "unauthorized",
  "not_found",
  "not_configured",
]);

export function agentsListingOutcome(
  row: AgentsListingSummary | null | undefined,
): AgentsListingOutcome | null {
  const outcome = row?.LastAgentsListingOutcome;
  if (outcome === INGESTION_PULL_LISTING_OUTCOME.LISTED) {
    return { outcome: "listed" };
  }
  if (outcome !== INGESTION_PULL_LISTING_OUTCOME.REFUSED) {
    // Null, or a word written by a release this build cannot read. Both mean
    // "we do not know how the last listing ended", and a screen that does not
    // know says so rather than picking the friendlier of the two claims.
    return null;
  }
  return {
    outcome: "refused",
    cause: ACCESS_REFUSAL_REASONS.has(row?.LastAgentsListingReason ?? "")
      ? "access"
      : "unreachable",
  };
}
