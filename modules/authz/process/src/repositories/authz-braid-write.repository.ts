import type { GrantCondition } from "@langwatch/authorization";
import type { Instant } from "@langwatch/time";

/** One braid write the service sent, recorded before its attach command (ADR-201 §1). */
export type AuthzBraidWrite = Readonly<{
  organizationId: string;
  commandId: string;
  grantId: string;
  readerProjectId: string;
  ownerProjectId: string;
  /** The identical-braid key: owner, compiled condition, data window and end date. */
  termsKey: string;
  condition: GrantCondition;
  expiresAt: Instant | null;
  replacesGrantId: string | null;
  createdByUserId: string | null;
  createdAt: Instant;
}>;

/**
 * ADR-201 §1: the braid writes sent into a reader, so a retry with its command id answers the
 * braid it saved and the reader's checks see a braid the grant projection has not landed yet.
 */
export abstract class AuthzBraidWriteRepository {
  /** The write a command id sent in this organisation; empty when none. */
  abstract findByCommand(input: {
    organizationId: string;
    commandId: string;
  }): Promise<AuthzBraidWrite[]>;

  /** Every write into a reader, oldest first: one the projection never landed counts at any age. */
  abstract findIntoReader(input: {
    organizationId: string;
    readerProjectId: string;
  }): Promise<AuthzBraidWrite[]>;

  /** Records a write; a second record under the same command id is refused by the store. */
  abstract create(input: { write: AuthzBraidWrite }): Promise<void>;

  /** Forgets a write whose command the ledger refused, so it never reads as in flight. */
  abstract delete(input: { organizationId: string; commandId: string }): Promise<void>;
}
