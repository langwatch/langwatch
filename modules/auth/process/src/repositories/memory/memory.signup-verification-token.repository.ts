import { Temporal, type Instant } from "@langwatch/time";
import type { SignUpVerificationTokenRepository } from "../signup-verification.repository.ts";
import type { MemoryAuthDatabase } from "./memory.auth.database.ts";

/**
 * The `VerificationToken` rows in memory. Spending removes the row before the
 * expiry is judged, exactly as the delete-then-check the Prisma twin runs: a
 * link that arrives late is still spent, so it cannot be replayed.
 */
export class MemorySignUpVerificationTokenRepository
  implements SignUpVerificationTokenRepository
{
  private constructor(private readonly memory: MemoryAuthDatabase) {}

  static create({
    memory,
  }: {
    memory: MemoryAuthDatabase;
  }): MemorySignUpVerificationTokenRepository {
    return new MemorySignUpVerificationTokenRepository(memory);
  }

  async issue({
    identifier,
    token,
    expires,
  }: {
    identifier: string;
    token: string;
    expires: Instant;
  }): Promise<void> {
    this.memory.verificationTokens.set(token, { identifier, token, expires });
  }

  async findAndClaim({
    token,
    now,
  }: {
    token: string;
    now: Instant;
  }): Promise<{ identifier: string } | null> {
    const claimed = this.memory.verificationTokens.get(token);

    if (!claimed) return null;
    this.memory.verificationTokens.delete(token);

    if (Temporal.Instant.compare(claimed.expires, now) <= 0) return null;

    return { identifier: claimed.identifier };
  }
}
