// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Recognising the Postgres constraint violations governance holds its rules
 * with, through whichever shape Prisma wrapped them in.
 *
 * The repo maps Prisma's own `P2002` and, before ADR-128, no raw SQLSTATE
 * anywhere — so a violation raised by the database arrived as a generic unknown
 * error with a trace id, for situations the customer can act on in one click.
 * Both the identity links (§11) and the key-to-bill coverage mapping (§7) hold
 * their rules as database constraints, so both need to read the code back.
 */

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

/** Postgres' exclusion-violation code: two rows overlap where none may. */
const EXCLUSION_VIOLATION = "23P01";

/** Postgres' check-violation code: a row a named CHECK refuses. */
const CHECK_VIOLATION = "23514";

/**
 * The driver's SQLSTATE, read off whichever shape carried it.
 *
 * Prisma surfaces a raw constraint violation as a `PrismaClientUnknownRequestError`
 * whose SQLSTATE lives in the message rather than in a field, so a structural
 * check alone misses it. All three places are checked, and the message check is
 * a word-boundary match rather than a `String(err).includes` over the whole
 * text — that would also match an error whose *payload* happened to contain the
 * digits.
 */
function hasSqlState(error: unknown, sqlState: string): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === sqlState) return true;
  const meta = (error as { meta?: { code?: unknown } }).meta;
  if (meta?.code === sqlState) return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === "string" && new RegExp(`\\b${sqlState}\\b`).test(message)
  );
}

/**
 * Whether a thrown value is the one-open-link index refusing a second open
 * link.
 *
 * Prisma's `P2002` wrapper is checked alongside the raw SQLSTATE because the
 * client catches this one itself before the driver's code can surface.
 */
export function isOpenLinkViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION)
    return true;
  return hasSqlState(error, UNIQUE_VIOLATION);
}

/** Whether a thrown value is an exclusion constraint refusing an overlap. */
export function isExclusionViolation(error: unknown): boolean {
  return hasSqlState(error, EXCLUSION_VIOLATION);
}

/**
 * Whether a thrown value is a CHECK constraint refusing a row.
 *
 * In governance that is always a validity range that covers no time — a
 * zero-width or inverted `[validFrom, validTo)`.
 */
export function isCheckViolation(error: unknown): boolean {
  return hasSqlState(error, CHECK_VIOLATION);
}
