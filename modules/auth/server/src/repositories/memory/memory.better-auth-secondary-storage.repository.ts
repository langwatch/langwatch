import { createLogger } from "@langwatch/observability";
import type { BetterAuthOptions } from "better-auth";

type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

const logger = createLogger("langwatch:better-auth");

// A dropped read is a cache miss better-auth recovers from the database
// (`storeSessionInDatabase: true`). A dropped WRITE has no such recovery, and
// the credential sign-in rate-limit counters live only here: dropping their
// `set` is a rate limit that fails OPEN. The degrade is right; being quiet
// about it is not.
export class MemoryBetterAuthSecondaryStorageRepository {
  private dropped = 0;

  private constructor() {}

  static create(): SecondaryStorage {
    const repository = new MemoryBetterAuthSecondaryStorageRepository();
    return {
      get: async () => null,
      getAndDelete: async () => null,
      increment: async () => {
        repository.report("increment");
        return 1;
      },
      set: async () => repository.report("set"),
      delete: async () => repository.report("delete"),
    };
  }

  // The key is deliberately absent: better-auth keys secondary storage by
  // session token, so the key IS a credential. The running count separates a
  // request that raced boot from a process serving auth without secondary
  // storage all along.
  private report(operation: "set" | "delete" | "increment"): void {
    this.dropped += 1;
    logger.warn(
      { operation, droppedSecondaryWrites: this.dropped },
      "better-auth secondary storage write dropped: the application has no Redis connection. Rate limiting and session revocation degrade to fail-open until it does.",
    );
  }
}
