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

/** Postgres' unique-violation code, raised by the one-open-link index. */
const UNIQUE_VIOLATION = "23505";

/**
 * Prisma's own code for the same refusal: the client wraps a unique violation
 * as a `PrismaClientKnownRequestError` with `code: "P2002"` and buries the
 * SQLSTATE underneath. `IdentityMatch` has no other unique rule a write could
 * trip (the primary key is a fresh nanoid), so `P2002` on these writes means
 * the one-open-link index and nothing else.
 */
const PRISMA_UNIQUE_VIOLATION = "P2002";

/**
 * Whether a thrown value is the one-open-link index refusing a second open
 * link.
 *
 * Reads the code off whichever shape carried it: Prisma's `P2002` wrapper, a
 * raw driver error's SQLSTATE in `code` or `meta.code`, or — for the wrapper
 * shapes whose SQLSTATE lives only in the message — a word-bounded match on
 * the message. Never a `String(err).includes` over the whole message: that
 * would also match an error whose *payload* happened to contain the digits.
 */
export function isOpenLinkViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === UNIQUE_VIOLATION || code === PRISMA_UNIQUE_VIOLATION)
    return true;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (meta?.code === UNIQUE_VIOLATION) return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    new RegExp(`\\b${UNIQUE_VIOLATION}\\b`).test(message)
  );
}
