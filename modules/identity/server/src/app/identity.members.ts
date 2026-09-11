import type { IdentifierProvider, IdentityCommand } from "@langwatch/identity-contract";
import type { TenantMigrationRecord } from "@langwatch/system-migrations";
import type { IdentityEvent } from "../projections/identity-state.projection.ts";

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
  awaitFold(input: {
    userId: string;
    tenantId: string;
    events: IdentityEvent[];
  }): Promise<void>;
}

/**
 * The event-sourcing stack every identity ledger STAGES through.
 *
 * The writers used to reach a service locator for it — `tryGetApp()`, waited
 * on for five seconds because better-auth builds its storage adapter at module
 * load, before any application exists. That wait was the locator's problem
 * rather than the ledger's: a process that composes its eventing before its
 * identity graph has the handle already, and one that never composes eventing
 * should say so rather than sleep and then fail.
 *
 * ONE method, and that is the doctrine rather than a small surface. Under
 * ADR-110 the queued run is the sole appender: it re-executes the same guard
 * the calling path ran and appends what it decides, so a ledger that appended
 * here as well would write every fact twice. The port used to carry a
 * `tryEventStore` beside this, which is what let one ledger keep the older
 * order — and on the tier those ledgers actually run, a producer, that append
 * was refused by name and took the whole ceremony with it. With no seam there
 * is no way back into it.
 *
 * `try…` because a deployment may run with the event stack disabled, and the
 * caller decides what that means. Three of the four ledgers refuse by name: a
 * command with nowhere to land is a failed ceremony, not a quiet one. The
 * directory-sync ledger is the exception and says why in its own docblock — an
 * identity provider's push must not fail because its history could not be
 * written — so it records the loss at `error`, naming the missing
 * registration, and lets the push through.
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
 * The two mails a join request's own timers send (D12).
 *
 * Only two, deliberately. The other four — arrived, approved, rejected, the
 * automatic-join notice — are sent by the request-side service in answer to
 * something a person did, and that service has not moved. These two are the
 * ones the process manager's wakes own: nobody asked for them, and if the
 * process that holds the wakes cannot send them, nobody sends them at all.
 *
 * The port takes resolved names and addresses rather than ids: deciding WHO is
 * told is this package's job, and WHAT they read is the composition root's,
 * beside the mail gateway and the deployment host every link is built from.
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

/**
 * The six messages a join request sends, as the notifier asks for them.
 *
 * The notifier decides WHO is told — it reads the organization's admins, the
 * requester's display name and their address — and this port decides WHAT they
 * read. That split is what keeps the react-email rendering, the mail gateway
 * and the deployment's public host out of every process that composes the
 * identity graph: a backend process resolving a join request must not pull a
 * React renderer onto its import graph to do it.
 *
 * Every method takes resolved names and addresses. Nothing here is asked to
 * look anything up.
 */
export interface JoinRequestNotificationMail {
  /** Somebody is asking. Sent to one organization admin. */
  sendRequestArrived(input: {
    adminEmail: string;
    organizationName: string;
    requesterName: string;
    domain: string;
    /**
     * How many requests from this domain have already been approved.
     *
     * An admin approving a third colleague from one domain is doing by hand
     * what one setting does for them. Absent, or below the habit floor, the
     * mail says nothing about it.
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
     * Why the organization came, where its row says.
     *
     * This message is the first one a new member gets, and unlike the sign-up
     * confirmation it is sent when an organization already exists to have an
     * answer. Absent falls back to the steps every reader can take.
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
     * A personal project of their own to work in meanwhile, when they have one.
     *
     * A second line and never the button: the thing this reader came for is the
     * organization, and asking again is what they do next.
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
     * Seats held after this join, against what the plan covers.
     *
     * Absent for an organization on enterprise or negotiated terms, whose
     * ceiling is its own rather than the public ladder's.
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
