import type { IdentifierProvider, IdentityCommand } from "@langwatch/identity-contract";
import type { TenantMigrationRecord } from "@langwatch/system-migrations";

import type { IdentityEvent } from "../eventing/identity-state.projection.ts";
import type { JoinRequestAudienceRepository } from "../repositories/join-request-audience.repository.ts";
import type { ScimSyncReadRepository } from "../repositories/scim-sync.repository.ts";
import type { SsoConnectionHistoryRepository } from "../repositories/sso-connection-history.repository.ts";
import type { SsoPlatformOperatorRepository } from "../repositories/sso-connection.repository.ts";
import type { IdentityLedger } from "../rules/identity-ledger.rules.ts";
import type { JoinRequestLedger } from "../rules/join-request-ledger.rules.ts";
import type { SsoConnectionLedger } from "../rules/sso-connection-ledger.rules.ts";
import type { IdentitySecretCarryRepository } from "../services/identity-secret-carry.service.ts";

/**
 * The newborn as the entrance takes them: better-auth's own canonical user row, plus the two
 * values the identity sequence needs pulled out of it. The row rides through as it arrived
 * rather than as a narrowed shape, so a better-auth version that adds a user field writes it.
 */
export interface IdentityNewborn {
  /** better-auth's canonical `user` row, keys and all. */
  row: Record<string, unknown>;
  /** The address the identifier is derived from, unnormalized. */
  email: string;
  /** Business time for the attach fact — the row's own `createdAt`. */
  createdAtMs: number;
}

/**
 * The entrance itself, as the adapter reaches it. The sequence lives in the
 * application, where the event store, Postgres and the migration-state table
 * are; the adapter only decides that this write is a birth.
 */
export abstract class IdentityBirth {
  /**
   * Run ADR-116 §3's sequence and answer the `User` row better-auth must be
   */
  abstract bear(newborn: IdentityNewborn): Promise<Record<string, unknown>>;
}

/** The fact an identifier id is derived from. */
export type DeriveIdentifierIdInput = {
  userId: string;
  provider: IdentifierProvider;
  providerAccountId: string | null;
  normalizedValue: string;
  occurredAtMs: number;
};

/**
 * Where an identifier fact's identity comes from.
 */
export interface IdentifierIdentity {
  /** The deterministic id this fact always derives, on any pass. */
  deriveIdentifierId(fact: DeriveIdentifierIdInput): string;
}

/**
 * The two ledger legs the born-finalized entrance sequences its own Deliberately not
 * `IdentityLedger`: that interface's `commit` is stage-then- wait in one call,
 * transaction between (ADR-116 §3).
 */
export interface IdentityBirthLedger {
  /** Hand the command to the engine. Refusing here fails the sign-up. */
  stage(input: { command: IdentityCommand }): Promise<void>;

  /** Wait, bounded, for the fold to carry these events. An observation. */
  awaitFold(input: { userId: string; tenantId: string; events: IdentityEvent[] }): Promise<void>;
}

/**
 * The event-sourcing stack an identity ledger STAGES through. ONE method, by
 * doctrine (ADR-110): the queued run is the sole appender, so appending here
 * too would double-write every fact. `try…` allows a deployment with no event stack.
 */
export interface IdentityEventing {
  /**
   * The named command sender on one pipeline, or `null` when this process
   * composed no event stack (or the pipeline is not registered on it).
   */
  tryPipelineCommand(input: {
    pipeline: string;
    command: string;
  }): Promise<{ send(data: unknown): Promise<unknown> } | null>;
}

/**
 * The two migration-state reads the per-user write fork is decided from. A port rather than the
 * state repository itself: the gate asks two questions of one row family, the runtime composes
 * whichever store answers them, and nothing here needs the runner's writes.
 */
export interface IdentityWriteGateState {
  /** One tenant's record for a migration, or null when it has none. */
  tryFindRecord(input: {
    migrationName: string;
    tenantId: string;
  }): Promise<TenantMigrationRecord | null>;

  /** Whether ANY tenant has finalized this migration. */
  hasFinalizedTenant(input: { migrationName: string }): Promise<boolean>;
}

/**
 * The two mails a join request's own timers send (D12). The port takes
 * resolved names/addresses: WHO is told is this package's job, WHAT they
 * read is the composition root's.
 */
export interface JoinRequestMail {
  /** The one nudge, on the seventh day. Sent to one organization admin. */
  sendStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<void>;

  /** Nobody answered in time. Sent to the requester, who may ask again. */
  sendExpired(input: { requesterEmail: string; organizationName: string }): Promise<void>;
}

/** What to publish again, named exactly, in both domain-proof mails. */
export type SsoDomainProofRecord = {
  recordType: string;
  recordName: string;
  recordLabel: string;
};

/**
 * The two mails a verified domain's evidence going missing sends (ADR-123).
 * Same split as {@link JoinRequestMail}: resolved names and addresses in,
 * the link and the envelope the composition root's.
 */
export interface SsoDomainProofMail {
  /** The record is gone and the grace has started. Sent to one admin. */
  sendProofWavering(input: {
    adminEmail: string;
    organizationName: string;
    domain: string;
    record: SsoDomainProofRecord;
    graceEndsAtMs: number;
  }): Promise<unknown>;

  /** The grace ran out. Sent to one admin. */
  sendProofLapsed(input: {
    adminEmail: string;
    organizationName: string;
    domain: string;
    record: SsoDomainProofRecord;
  }): Promise<unknown>;
}

/**
 * The notifier decides WHO is told; this port decides WHAT they read. That
 * split keeps react-email rendering and the mail gateway out of every process
 * composing the identity graph. Every method takes resolved names/addresses.
 */
export interface JoinRequestNotificationMail {
  /** Somebody is asking. Sent to one organization admin. */
  sendRequestArrived(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
    domain: string;
    /**
     * How many requests from this domain have already been approved. Absent,
     * or below the habit floor, the mail says nothing about it.
     */
    approvedFromDomainCount?: number;
  }): Promise<unknown>;

  /** The one nudge, on the seventh day. Sent to one organization admin. */
  sendRequestStillWaiting(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
  }): Promise<unknown>;

  /** They are in. Sent to the requester. */
  sendRequestApproved(input: {
    requesterEmail: string;
    organizationName: string;
    /**
     * Why the organization came, where its row says it. Absent falls back to
     * the steps every reader can take.
     */
    intent?: "AGENT_GOVERNANCE" | "LLM_OPS";
  }): Promise<unknown>;

  /** They are not. Sent to the requester, who may ask again after the cool-down. */
  sendRequestRejected(input: {
    requesterEmail: string;
    organizationName: string;
  }): Promise<unknown>;

  /** Nobody answered in time. Sent to the requester, who may ask again. */
  sendRequestExpired(input: {
    requesterEmail: string;
    organizationName: string;
    /**
     * A personal project to work in meanwhile, when they have one. A second
     * line, never the button — the organization is what this reader came for.
     */
    personalProjectUrl?: string;
  }): Promise<unknown>;

  /** The domain policy admitted somebody. Sent to one organization admin. */
  sendJoinedAutomatically(input: {
    adminEmail: string;
    organizationName: string;
    memberName: string;
    domain: string;
    /**
     * Seats held after this join, against what the plan covers. Absent for
     * enterprise/negotiated terms, whose ceiling is not the public ladder's.
     */
    seats?: { used: number; ceiling: number };
  }): Promise<unknown>;
}

/**
 * Who this deployment counts as a LangWatch platform operator, by address. The answer is
 * `ADMIN_EMAILS`, and the ops feature owns both the variable and the comparison.
 */
export interface PlatformOperator {
  /** Whether this address is on the deployment's operator list. */
  isPlatformOperatorEmail(input: { email: string | null }): boolean;
}

/**
 * What the process supplies this feature beyond its twelve repository rows:
 * eventing, operators, join-request mail, latch knobs, write-side heads
 * (Q3(b) — each needs `EventSourcing`, so stays process-side).
 */
export type IdentityInfrastructure = Readonly<{
  /**
   * How every identity command stages. Present in all three processes; a
   * producer-only stand-in where the process composed no queue.
   */
  eventing: IdentityEventing;
  /** The deployment's operator list, for the SSO connection guards. `ADMIN_EMAILS`, not `ops:*`. */
  operators: PlatformOperator;
  /**
   * How the two wake-driven join-request mails are rendered and sent, or
   * nothing where the process composed no gateway.
   */
  mail: JoinRequestMail | null;
  /** Overridden only by tests that need the latch to expire or evict inside one run. */
  latch: Readonly<{ ttlMs: number; maxUsers: number; now: () => number }>;
  /**
   * The identifier ledger's append-and-converge surface, built by the
   * process from its own Prisma client and its own `reservations` row.
   */
  ledger: IdentityLedger;
  /** The join-request ledger's append-and-converge surface, over the same `eventing`. */
  joinRequestLedger: JoinRequestLedger;
  /** The three backfill reads the D01 secret-carry pass writes through. */
  secrets: IdentitySecretCarryRepository;
  /** Who a join-request notification reaches. Read only when `mail` is present. */
  joinRequestAudience: JoinRequestAudienceRepository;
  /** Who counts as a LangWatch platform operator, for the SSO connection guards (D05 tier 1). */
  ssoPlatformOperators: SsoPlatformOperatorRepository;
  /**
   * The SSO connection ledger's append surface, or nothing where the process
   * composed no SSO connection store. Mirrors `mail`: absent means the
   * capability refuses by name rather than answering emptily.
   */
  ssoConnectionLedger: SsoConnectionLedger | null;
  /**
   * One connection's own log, read. Null where the process composed no event
   * stack — the history refuses by name rather than reading as empty, which
   * would be indistinguishable from a connection nothing ever happened to.
   */
  ssoConnectionHistory: SsoConnectionHistoryRepository | null;
  /** The folded state of one connection's directory sync (D08). */
  scimSyncs: ScimSyncReadRepository;
}>;
