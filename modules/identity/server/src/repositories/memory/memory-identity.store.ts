import type {
  BackfillIdentifierRow,
  IdentifierFact,
  JoinCandidateOrganization,
  JoinRequestAggregateState,
  MfaEnrollmentState,
  SsoConnectionState,
} from "@langwatch/identity-contract";
import type { Instant } from "@langwatch/time";
import type {
  BackfillAccountRow,
  BackfillUserRow,
} from "../identity-backfill.repository.ts";
import type { IdentifierReservationHolder } from "../identity-reservations.repository.ts";
import type { IdentityVerificationRecord } from "../identity-verification.repository.ts";

/** The `User` row as the memory tier keeps it, plus the opaque payload a
 *  newborn commit carries through. */
export interface MemoryUserRow {
  id: string;
  email: string | null;
  emailVerified: boolean;
  createdAtMs: number;
  userHashKey: string | null;
  payload: Record<string, unknown>;
}

/**
 * One in-memory store behind every identity repository twin, the way one
 * Postgres connection sits behind every Prisma one: an identifier written
 * through the heads rows is what the reservations, the verification and the
 * backfill rows answer from.
 */
export class MemoryIdentityStore {
  static create(): MemoryIdentityStore {
    return new MemoryIdentityStore();
  }

  private constructor() {}

  readonly users = new Map<string, MemoryUserRow>();
  readonly identifiers = new Map<string, IdentifierFact>();
  readonly accounts = new Map<string, BackfillAccountRow[]>();
  readonly backfillIdentifiers = new Map<string, BackfillIdentifierRow[]>();
  readonly reservations = new Map<string, IdentifierReservationHolder>();
  readonly verifications = new Map<string, IdentityVerificationRecord>();
  readonly newbornClaims = new Map<string, Instant>();
  readonly mfaEnrollments = new Map<string, MfaEnrollmentState>();
  readonly mfaRequiringSlugs = new Map<string, readonly string[]>();
  readonly joinRequests = new Map<string, JoinRequestAggregateState>();
  readonly joinRejections = new Map<string, Instant>();
  readonly joinCandidates = new Map<string, JoinCandidateOrganization[]>();
  readonly ssoConnections = new Map<string, SsoConnectionState>();
  readonly organizationNames = new Map<string, string>();
  readonly finalizedUsers = new Set<string>();

  findUserRow(args: { userId: string }): MemoryUserRow | null {
    return this.users.get(args.userId) ?? null;
  }

  findIdentifiersForUser(args: { userId: string }): IdentifierFact[] {
    return [...this.identifiers.values()].filter((fact) => fact.userId === args.userId);
  }

  static rejectionKey(args: { userId: string; organizationId: string }): string {
    return `${args.userId}:${args.organizationId}`;
  }
}
