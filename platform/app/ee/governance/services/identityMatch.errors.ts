// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the match engine refuses to do, said in words the reviewer can act on
 * (ADR-128 §12).
 *
 * Both of these are races rather than mistakes: a review queue is read by
 * people, and between reading it and clicking, the world moves. The whole point
 * of naming them is that the loser of such a race should be told what happened,
 * not handed a trace id.
 *
 * Spec: specs/governance/governance-identity-match-engine.feature
 */
import { HandledError, NotFoundError } from "@langwatch/handled-error";

/**
 * The suggestion is gone — already confirmed, or replaced by a later pass of
 * the job whose inputs no longer imply it.
 */
export class IdentityMatchSuggestionNotFoundError extends NotFoundError {
  declare readonly code: "identity_match_suggestion_not_found";

  constructor(suggestionId: string) {
    super(
      "identity_match_suggestion_not_found",
      "Match suggestion",
      suggestionId,
    );
    this.name = "IdentityMatchSuggestionNotFoundError";
  }
}

/**
 * The person already holds an open link.
 *
 * Raised on the read that finds the link, and again from SQLSTATE 23505 when
 * two confirmations race past that read — the partial unique index on
 * `IdentityMatch` (one open link per person) is what actually holds the rule,
 * and it deserves the same sentence as the check that usually gets there
 * first. `fault` stays customer: clicking a stale queue entry is an ordinary
 * thing for a person to do, not an incident.
 */
export class IdentityAlreadyLinkedError extends HandledError {
  declare readonly code: "identity_already_linked";

  constructor(discoveredPersonId: string) {
    super(
      "identity_already_linked",
      "This person is already linked to an account",
      {
        httpStatus: 409,
        fault: "customer",
        meta: { discoveredPersonId },
      },
    );
    this.name = "IdentityAlreadyLinkedError";
  }
}

/**
 * The person has been erased, so nothing may link an account to them again.
 *
 * The erasure deletes their pending suggestions, so ordinarily there is nothing
 * left to confirm. This covers the window that deletion cannot: a queue read
 * before the erasure ran and clicked after it, and the moments inside the
 * erasure itself where the person row is not yet marked. `fault` is customer
 * because clicking a stale queue entry is an ordinary thing for a person to do
 * — but unlike the other two, this refusal is the last thing standing between a
 * click and an erased person carrying an account again.
 */
export class IdentityErasedError extends HandledError {
  declare readonly code: "identity_erased";

  constructor(discoveredPersonId: string) {
    super(
      "identity_erased",
      "This person has been erased and cannot be linked to an account",
      {
        httpStatus: 409,
        fault: "customer",
        meta: { discoveredPersonId },
      },
    );
    this.name = "IdentityErasedError";
  }
}
