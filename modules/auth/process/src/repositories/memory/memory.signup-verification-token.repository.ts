import { generate } from "@langwatch/ksuid";
import { fromDate, Temporal, toDate, type Instant } from "@langwatch/time";

import type {
  SignUpVerificationTokenRepository,
  TokenClaim,
} from "../signup-verification.repository.ts";
import type { MemoryAuthDatabase, MemoryVerificationTokenRow } from "./memory.auth.database.ts";

/** A spent row's namespace: recognised by `findSpent`, never claimable. */
const SPENT_NAMESPACE = "identity-signup-spent:";

const UNCLAIMED: TokenClaim = { claimed: false };

function isLive({ row, now }: { row: MemoryVerificationTokenRow; now: Instant }): boolean {
  return Temporal.Instant.compare(fromDate(row.expires), now) > 0;
}

/**
 * The `VerificationToken` rows of the shared memory-adapter database; a claim
 * renames the row into the spent namespace. Every method reads
 * `db.VerificationToken` afresh, because a commit or a delete replaces it.
 */
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
    this.memory.db.VerificationToken = [
      ...this.memory.db.VerificationToken.filter((row) => row.token !== token),
      { id: generate("auth").toString(), identifier, token, expires: toDate(expires) },
    ];
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
    const row = this.find(token);
    if (!row || !isLive({ row, now })) return UNCLAIMED;
    if (row.identifier.startsWith(SPENT_NAMESPACE)) return UNCLAIMED;

    this.memory.db.VerificationToken = this.memory.db.VerificationToken.map((candidate) =>
      candidate.token === token
        ? {
            ...candidate,
            identifier: `${SPENT_NAMESPACE}${row.identifier}`,
            expires: toDate(keepSpentUntil),
          }
        : candidate,
    );

    return { claimed: true, identifier: row.identifier };
  }

  async findSpent({
    token,
    now,
  }: {
    token: string;
    now: Instant;
  }): Promise<{ identifier: string } | null> {
    const row = this.find(token);
    if (!row || !isLive({ row, now })) return null;
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
    const row = this.find(token);

    if (!row || row.identifier !== identifier) return false;
    if (!isLive({ row, now })) return false;
    this.memory.db.VerificationToken = this.memory.db.VerificationToken.filter(
      (candidate) => candidate.token !== token,
    );

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
    const row = this.find(token);

    return row !== undefined && row.identifier === identifier && isLive({ row, now });
  }

  private find(token: string): MemoryVerificationTokenRow | undefined {
    return this.memory.db.VerificationToken.find((row) => row.token === token);
  }
}
