import { Temporal, type Instant } from "@langwatch/time";

import type {
  SignUpVerificationTokenRepository,
  TokenClaim,
} from "../signup-verification.repository.ts";
import type { MemoryAuthDatabase } from "./memory.auth.database.ts";

/** A spent row's namespace: recognised by `findSpent`, never claimable. */
const SPENT_NAMESPACE = "identity-signup-spent:";

const UNCLAIMED: TokenClaim = { claimed: false };

/** The `VerificationToken` rows in memory; a claim renames the row into the spent namespace. */
export class MemorySignUpVerificationTokenRepository implements SignUpVerificationTokenRepository {
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

  async claim({
    token,
    now,
    keepSpentUntil,
  }: {
    token: string;
    now: Instant;
    keepSpentUntil: Instant;
  }): Promise<TokenClaim> {
    const row = this.memory.verificationTokens.get(token);
    if (!row || Temporal.Instant.compare(row.expires, now) <= 0) return UNCLAIMED;
    if (row.identifier.startsWith(SPENT_NAMESPACE)) return UNCLAIMED;

    this.memory.verificationTokens.set(token, {
      identifier: `${SPENT_NAMESPACE}${row.identifier}`,
      token,
      expires: keepSpentUntil,
    });

    return { claimed: true, identifier: row.identifier };
  }

  async findSpent({
    token,
    now,
  }: {
    token: string;
    now: Instant;
  }): Promise<{ identifier: string } | null> {
    const row = this.memory.verificationTokens.get(token);
    if (!row || Temporal.Instant.compare(row.expires, now) <= 0) return null;
    if (!row.identifier.startsWith(SPENT_NAMESPACE)) return null;

    return { identifier: row.identifier.slice(SPENT_NAMESPACE.length) };
  }

  async claimExpected({
    token,
    identifier,
    now,
  }: {
    token: string;
    identifier: string;
    now: Instant;
  }): Promise<boolean> {
    const row = this.memory.verificationTokens.get(token);

    if (!row || row.identifier !== identifier) return false;
    if (Temporal.Instant.compare(row.expires, now) <= 0) return false;
    this.memory.verificationTokens.delete(token);

    return true;
  }

  async hasExpected({
    token,
    identifier,
    now,
  }: {
    token: string;
    identifier: string;
    now: Instant;
  }): Promise<boolean> {
    const row = this.memory.verificationTokens.get(token);

    return (
      row !== undefined &&
      row.identifier === identifier &&
      Temporal.Instant.compare(row.expires, now) > 0
    );
  }
}
