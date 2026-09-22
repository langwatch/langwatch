import type {
  BackfillIdentifierRow,
  BreakGlassBinding,
  IdentifierFact,
  JoinCandidateOrganization,
  JoinRequestAggregateState,
  MfaEnrollmentState,
  SsoConnectionState,
  SsoCredentialKind,
} from "@langwatch/identity-contract";
import type { Instant } from "@langwatch/time";

import type { SsoEngineProviderRow } from "../../rules/sso-engine-provider.rules.ts";
import type { BackfillAccountRow } from "../identity-backfill.repository.ts";
import type { IdentifierReservationHolder } from "../identity-reservations.repository.ts";
import type { LegacySignInAccount } from "../identity-signin-accounts.repository.ts";
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
 * Postgres connection sits behind every Prisma one: the heads rows are what
 * reservations, verification, and backfill answer from.
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
  /** The engine's provider rows, keyed by the connection they project. */
  readonly ssoEngineProviders = new Map<string, SsoEngineProviderRow>();
  /** When the re-proof sweep last LOOKED at a connection, by its id. */
  readonly ssoReproofCursors = new Map<string, number>();
  /** The credential vault's twin, keyed by the reference a write minted. */
  readonly ssoCredentials = new Map<
    string,
    { organizationId: string; connectionId: string; kind: SsoCredentialKind; value: string }
  >();
  /** Every sign-in a connection decided, as the activity table records it. */
  readonly ssoAuthentications: {
    organizationId: string;
    connectionId: string;
    userId: string;
    authenticatedAtMs: number;
    providerAccountId: string | null;
  }[] = [];
  readonly organizationNames = new Map<string, string>();
  readonly finalizedUsers = new Set<string>();
  /** Keyed by the lowercased address, the way the legacy read matches it. */
  readonly legacySignInAccounts = new Map<string, LegacySignInAccount>();
  readonly breakGlassBindings = new Map<string, BreakGlassBinding>();
  /** Activation reservations, keyed by the command that took them. */
  readonly breakGlassReservations = new Map<
    string,
    { commandId: string; organizationId: string; connectionId: string }
  >();

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
