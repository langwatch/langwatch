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
 * line by scanning the customer trees for the column name; this file is on the
 * other side of that boundary, which is exactly why the branching belongs here
 * rather than in the page.
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
import type { ListingRefusalReason } from "./providerListing";

/**
 * What a person has to DO about a refusal, which is the only reason a screen
 * branches on one at all.
 *
 * Three values rather than the eight the refusal vocabulary carries, because
 * there are three different actions and no more:
 *   `access`      — somebody has to fix a credential, a permission or a
 *                   connection's configuration. Asking again changes nothing
 *                   until they do.
 *   `unreachable` — the provider did not answer, or answered badly. Asking
 *                   again later is the action and there is nothing to fix.
 *   `incomplete`  — the provider answered everything it was asked and we
 *                   stopped first. There is no action: nothing is broken, and
 *                   asking again walks the same pages to the same bound.
 *
 * Telling a reader whose provider was rate-limited to go check their
 * credentials sends them to audit a permission that was never the problem,
 * which is why this is not one generic refusal sentence. `incomplete` exists
 * for the same reason in the other direction: it is the only cause whose
 * honest advice is that pressing the button again is not worth doing.
 */
export type AgentsListingRefusalCause = "access" | "unreachable" | "incomplete";

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
 * Every refusal reason, and the one thing its reader should do about it.
 *
 * EXHAUSTIVE ON PURPOSE, and typed rather than a set of the interesting ones.
 * A safe-list of `access` reasons with everything else falling through reads
 * fine until somebody adds a reason: the new one lands on the fallback in
 * silence and ships whatever advice that fallback happens to give. That is not
 * hypothetical. `too_many_pages` was added with exactly that shape, and until
 * this table existed it told a customer that a provider which had answered
 * every single request had not answered, and to ask again. Written this way,
 * the next reason added to the vocabulary fails the typecheck here until
 * somebody decides what its reader should do, which is the only moment anyone
 * is in a position to decide it.
 *
 * `not_found` is `access` rather than transient: a 404 on a listing endpoint
 * is an address naming no such collection, which is configuration, and telling
 * that reader to try again later leaves them pressing a button forever.
 */
const REFUSAL_CAUSE: Record<ListingRefusalReason, AgentsListingRefusalCause> = {
  unauthorized: "access",
  not_found: "access",
  not_configured: "access",
  rate_limited: "unreachable",
  unavailable: "unreachable",
  unreachable: "unreachable",
  malformed_response: "unreachable",
  too_many_pages: "incomplete",
  // Incomplete rather than unreachable, and the distinction is the advice: the
  // provider answered every request, so nothing about the credential is in
  // question, and the next walk stalls in the same place, so "try again" would
  // send this reader round a loop.
  pagination_stalled: "incomplete",
};

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
  // A reason written by a release this build cannot read stays `unreachable`.
  // It is the only cause that claims nothing: `access` would send somebody to
  // audit a credential that may be fine, and `incomplete` asserts both that
  // nothing is broken and that asking again is pointless, neither of which is
  // knowable about a word we cannot read. The cost of being wrong here is one
  // wasted press, which is the cheapest of the three.
  const reason = row?.LastAgentsListingReason ?? "";
  return { outcome: "refused", cause: refusalCause(reason) };
}

/**
 * The cause for a reason string, which is a free-form database column and not
 * a member of the union it is cast to.
 *
 * `Object.hasOwn` before indexing, and not the bare lookup with `??`. Indexing
 * an object literal reaches its prototype, so `toString`, `constructor`,
 * `valueOf` and `hasOwnProperty` come back as inherited functions — truthy, so
 * `??` never fires, and a Function reaches the screen where a cause belongs.
 * `REFUSAL_VOICE` has no entry for it, and reading a headline off `undefined`
 * throws where a refusal message was supposed to render.
 *
 * That is a crash and not a wrong sentence, which makes it worse than the bug
 * this fallback exists to prevent. The set-membership check this replaced was
 * immune; the table is the improvement and the bare lookup was the mistake.
 *
 * Nothing writes those words today. The guard is not about today: this column
 * is untrusted on purpose, because the log outlives the vocabulary and a later
 * release may write a reason this build has never heard of. Code that
 * anticipates an unknown word owes it the same answer for every unknown word,
 * not just the ones that are not also property names.
 */
function refusalCause(reason: string): AgentsListingRefusalCause {
  if (!Object.hasOwn(REFUSAL_CAUSE, reason)) return "unreachable";
  return REFUSAL_CAUSE[reason as ListingRefusalReason];
}
