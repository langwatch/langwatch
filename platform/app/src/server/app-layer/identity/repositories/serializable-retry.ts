import { z } from "zod";
import { Prisma } from "~/generated/prisma/client";

const MAX_SERIALIZATION_ATTEMPTS = 4;

/**
 * The window the first retry's wait is drawn from, in milliseconds. Doubles
 * each round, so the three waits a run can make are drawn from 10, 20 and
 * 40 ms — a click that lost one race waits at most ten milliseconds more,
 * and one that lost all three waited at most seventy.
 */
const RETRY_WAIT_BASE_MS = 10;

/** What the retry needs from the outside world, so a test can hold it still. */
export interface SerializationRetryDeps {
  /** Resolves after `ms` milliseconds. */
  wait: (ms: number) => Promise<void>;
  /** A draw in `[0, 1)`. */
  random: () => number;
}

const REAL_DEPS: SerializationRetryDeps = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

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
 *
 * Waits between attempts, briefly and at random. Two transactions that lose
 * to EACH OTHER restart at the same instant when nothing separates them, so
 * they conflict again at the same instant, and again, until the budget is
 * spent with neither having committed — and the raw conflict reaches the
 * person after all. CI showed exactly that shape: four conflicts, three
 * milliseconds apart, from one pair of overlapping deletes (#8200). A wait
 * drawn at random from a window that doubles each round pulls the pair apart
 * so that one of them runs alone. Nothing about the decision changes: only
 * conflicts are retried, four attempts is still the limit, and what was
 * thrown is what the caller gets.
 */
export async function withSerializationRetry<T>(
  run: () => Promise<T>,
  { wait, random }: SerializationRetryDeps = REAL_DEPS,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (
        attempt + 1 < MAX_SERIALIZATION_ATTEMPTS &&
        isSerializationConflict(error)
      ) {
        await wait(retryWaitMs({ attempt, random }));
        continue;
      }
      throw error;
    }
  }
  /* v8 ignore next 2 -- the loop either returns or throws on the last attempt */
  throw new Error("unreachable: serialization retries exhausted");
}

/**
 * How long to wait after losing `attempt`: a uniform draw from a window that
 * starts at {@link RETRY_WAIT_BASE_MS} and doubles each round. Uniform rather
 * than fixed because a fixed wait separates nobody — two callers that lost
 * together would simply wait together — and drawn over a growing window so
 * that a pair the first draw failed to separate gets more room next time.
 */
function retryWaitMs({
  attempt,
  random,
}: {
  attempt: number;
  random: () => number;
}): number {
  return random() * RETRY_WAIT_BASE_MS * 2 ** attempt;
}
