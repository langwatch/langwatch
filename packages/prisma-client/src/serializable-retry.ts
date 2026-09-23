import { z } from "zod";

const MAX_SERIALIZATION_ATTEMPTS = 4;

/** The first retry's wait window in ms; it doubles each round (10, 20, 40). */
const RETRY_WAIT_BASE_MS = 10;

/** What the retry needs from the outside world, so a test can hold it still. */
export interface SerializationRetryDeps {
  wait: (ms: number) => Promise<void>;
  /** A draw in `[0, 1)`. */
  random: () => number;
}

const REAL_DEPS: SerializationRetryDeps = {
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};

const prismaWriteConflictSchema = z.object({ code: z.literal("P2034") });

/** The driver adapter reports the same lost race as an untyped shape. */
const driverWriteConflictSchema = z.object({
  name: z.literal("DriverAdapterError"),
  cause: z.object({ kind: z.literal("TransactionWriteConflict") }),
});

export function isSerializationConflict(error: unknown): boolean {
  return (
    prismaWriteConflictSchema.safeParse(error).success ||
    driverWriteConflictSchema.safeParse(error).success
  );
}

/**
 * Runs a SERIALIZABLE transaction again when it lost a race, and only then:
 * four attempts, a random wait from a doubling window between them so two
 * losers do not restart in lockstep (#8200, specs/identity/authentication-settings.feature).
 */
export async function withSerializationRetry<T>(
  run: () => Promise<T>,
  { wait, random }: SerializationRetryDeps = REAL_DEPS,
): Promise<T> {
  for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt + 1 < MAX_SERIALIZATION_ATTEMPTS && isSerializationConflict(error)) {
        await wait(random() * RETRY_WAIT_BASE_MS * 2 ** attempt);
        continue;
      }
      throw error;
    }
  }
  throw new Error("unreachable: serialization retries exhausted");
}
