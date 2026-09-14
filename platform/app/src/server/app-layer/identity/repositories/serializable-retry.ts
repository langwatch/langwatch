import { z } from "zod";
import { Prisma } from "~/generated/prisma/client";

const MAX_SERIALIZATION_ATTEMPTS = 4;

/**
 * Postgres reports a serialization failure two different ways depending on
 * which layer notices it: Prisma's own `P2034`, and the driver adapter's
 * `TransactionWriteConflict`, which arrives as an untyped shape rather than a
 * `PrismaClientKnownRequestError`. Both mean the same thing — this
 * transaction lost a race and committed nothing — so both are matched.
 */
const driverWriteConflictSchema = z.object({
  name: z.literal("DriverAdapterError"),
  cause: z.object({ kind: z.literal("TransactionWriteConflict") }),
});

export function isSerializationConflict(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2034") ||
    driverWriteConflictSchema.safeParse(error).success
  );
}

/**
 * Runs a SERIALIZABLE transaction again when it lost a race, and only then.
 *
 * WHY THIS IS NOT OPTIONAL. Serializable isolation is what makes a
 * read-then-write decision safe — the "count the ways in, then delete one"
 * shape both last-way-in repositories use. It buys that by refusing to commit
 * the loser of a race, which means a caller that does not retry converts a
 * race it correctly detected into a raw write-conflict exception on its way
 * to a person.
 *
 * Observed: two overlapping unlinks of the same account — a double-clicked
 * cross — left the survivor's request answering with a driver error instead
 * of the `would_strand_user` refusal the guard had computed. The isolation
 * level was doing its job; nothing was asking it a second time.
 *
 * Retrying is safe precisely because the loser committed nothing: the second
 * attempt reads the state the winner left and decides again from it, which is
 * the answer the person would have got had they clicked a moment later.
 *
 * Bounded at four attempts. A conflict that survives four rounds is not a
 * race between two clicks any more, and burying it under further retries
 * would hide a real problem rather than smooth one over.
 */
export async function withSerializationRetry<T>(
  run: () => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (
        attempt + 1 < MAX_SERIALIZATION_ATTEMPTS &&
        isSerializationConflict(error)
      ) {
        continue;
      }
      throw error;
    }
  }
  /* v8 ignore next 2 -- the loop either returns or throws on the last attempt */
  throw new Error("unreachable: serialization retries exhausted");
}
