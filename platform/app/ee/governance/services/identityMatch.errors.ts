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
 * Raised on the read that finds the link, and again from SQLSTATE 23P01 when
 * two confirmations race past that read — the exclusion constraint on
 * `IdentityMatch` is what actually holds the rule, and it deserves the same
 * sentence as the check that usually gets there first. `fault` stays customer:
 * clicking a stale queue entry is an ordinary thing for a person to do, not an
 * incident.
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
 * Postgres' exclusion-violation code.
 *
 * The repo maps Prisma's `P2002` and, before this, no exclusion violation
 * anywhere — so an overlap raised by the database arrived as a generic unknown
 * error with a trace id, for a situation the customer can act on in one click.
 */
const EXCLUSION_VIOLATION = "23P01";

/**
 * Whether a thrown value is the overlap constraint refusing a second open link.
 *
 * Reads the driver's own code off whichever shape carried it: Prisma surfaces a
 * raw constraint violation as a `PrismaClientUnknownRequestError` whose SQLSTATE
 * lives in the message rather than in a field, so a structural check alone
 * misses it. Both are checked, and neither is a `String(err).includes` over the
 * whole message — that would also match an error whose *payload* happened to
 * contain the digits.
 */
export function isExclusionViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === EXCLUSION_VIOLATION) return true;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (meta?.code === EXCLUSION_VIOLATION) return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" &&
    new RegExp(`\\b${EXCLUSION_VIOLATION}\\b`).test(message)
  );
}
