// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The technical shape this feature asks the process for: the identity
 * aggregate's connection ledger, as the back office commands it, and where
 * the gate's decisions are written.
 */
import type {
  ActivateSsoConnectionInput,
  BackofficeSsoConnection,
  BackofficeSsoConnectionPage,
  ListSsoConnectionsInput,
  RegisterSsoConnectionInput,
  AttestSsoDomainInput,
  RejectSsoDomainClaimInput,
  SsoBreakGlassBinding,
  SsoBreakGlassBindingInput,
  SsoBreakGlassCandidate,
  SsoBreakGlassGrant,
  SsoBreakGlassRenewal,
  SsoConnectionByIdInput,
  SsoConnectionReasonInput,
  SsoConnectionTarget,
  SsoDomainClaimOutcome,
  SsoDomainProof,
  SsoDomainProved,
  SsoDomainTarget,
  SsoSetupArrivalsInput,
  SsoSetupConnectionInput,
  SsoSetupDomainInput,
  SsoSetupMigration,
  SsoSetupMigrationProgressInput,
  SsoSetupMigrationRouteInput,
  SsoSetupOrganizationInput,
  SsoSetupPageView,
  SsoSetupRegistration,
  SsoSetupRemovalInput,
} from "@langwatch/enterprise-sso-contract";

/** The operator a command is appended under. The ledger mints nothing itself. */
export type SsoConnectionLedgerOperator = Readonly<{ userId: string }>;

type Commanded<Input> = Input & Readonly<{ operator: SsoConnectionLedgerOperator }>;

/** How long a removal stays reversible before the process manager completes it. */
export type SsoConnectionTeardownRequest = Commanded<SsoConnectionReasonInput> &
  Readonly<{ graceMs: number }>;

export interface SsoConnectionLedger {
  list(input: ListSsoConnectionsInput): Promise<BackofficeSsoConnectionPage>;
  /** `null` when no connection carries that id; absence is a normal answer here. */
  findById(input: SsoConnectionByIdInput): Promise<BackofficeSsoConnection | null>;
  registerConnection(input: Commanded<RegisterSsoConnectionInput>): Promise<unknown>;
  claimDomain(input: Commanded<SsoDomainTarget>): Promise<void>;
  approveDomainClaim(input: Commanded<SsoDomainTarget>): Promise<void>;
  rejectDomainClaim(input: Commanded<RejectSsoDomainClaimInput>): Promise<void>;
  attestDomain(input: Commanded<AttestSsoDomainInput>): Promise<void>;
  activateConnection(input: Commanded<ActivateSsoConnectionInput>): Promise<void>;
  suspendConnection(input: Commanded<SsoConnectionReasonInput>): Promise<void>;
  resumeConnection(input: Commanded<SsoConnectionTarget>): Promise<void>;
  requestTeardown(input: SsoConnectionTeardownRequest): Promise<void>;
}

/** The administrator the ceremony's facts name. Minted from the session by
 *  the transport, never taken from an input. */
export type SsoSelfServeActor = Readonly<{ userId: string }>;

/**
 * The organization's own half of the domain ceremony (ADR-123), as identity
 * offers it. Separate from the back office's ledger above because the two
 * surfaces are gated apart and only share the aggregate underneath.
 */
export interface SsoDomainCeremonyLedger {
  claimDomain(input: SsoSetupDomainInput, actor: SsoSelfServeActor): Promise<SsoDomainClaimOutcome>;
  proveDomain(input: SsoSetupDomainInput, actor: SsoSelfServeActor): Promise<SsoDomainProof>;
  removeDomain(input: SsoSetupDomainInput, actor: SsoSelfServeActor): Promise<void>;
  checkDomainRecord(input: SsoSetupDomainInput, actor: SsoSelfServeActor): Promise<SsoDomainProved>;
  checkDomainFile(input: SsoSetupDomainInput, actor: SsoSelfServeActor): Promise<SsoDomainProved>;
}

/**
 * The rest of the organization's own journey, as identity offers it: the
 * ceremony above is its domain half, and these are the presses either side of
 * it. Stated as this module's own demand, so a signature identity changes
 * stops this from compiling rather than reaching a screen half-wired.
 */
export interface SsoSetupCommandLedger {
  register(
    input: {
      organizationId: string;
      /** What the administrator calls this provider. */
      providerId: string;
      registration: SsoSetupRegistration;
    },
    actor: SsoSelfServeActor,
  ): Promise<{ connectionId: string }>;
  /** The replacement for a grandfathered connection, registered with the same
   *  evidence and carrying over the domains that one already proved. */
  startLegacyMigration(
    input: {
      organizationId: string;
      legacyConnectionId: string;
      providerId: string;
      registration: SsoSetupRegistration;
    },
    actor: SsoSelfServeActor,
  ): Promise<{ connectionId: string }>;
  /** Which half of the pair decides ordinary sign-ins. */
  selectMigrationRoute(
    input: SsoSetupConnectionInput & { route: SsoSetupMigrationRouteInput["route"] },
    actor: SsoSelfServeActor,
  ): Promise<void>;
  /** The cutover's end, re-read and resumable where identity states it. */
  finalizeLegacyMigration(input: SsoSetupConnectionInput, actor: SsoSelfServeActor): Promise<void>;
  rename(
    input: SsoSetupConnectionInput & { name: string },
    actor: SsoSelfServeActor,
  ): Promise<void>;
  setArrivals(
    input: SsoSetupConnectionInput & { arrivalPolicy: SsoSetupArrivalsInput["policy"] },
    actor: SsoSelfServeActor,
  ): Promise<void>;
  /** Going live reads its own evidence: what the connection recorded decides,
   *  never an account the caller names. */
  activate(input: SsoSetupConnectionInput, actor: SsoSelfServeActor): Promise<void>;
  discardConnection(input: SsoSetupConnectionInput, actor: SsoSelfServeActor): Promise<void>;
  /** Which removal it was is read from where the connection stands, never
   *  chosen by the caller. */
  removeConnection(
    input: SsoSetupRemovalInput & { graceMs: number },
    actor: SsoSelfServeActor,
  ): Promise<{ removal: "discarded" | "teardown-requested" }>;
}

/**
 * The way back in (D05, ADR-117 §5), as identity offers it. Two reads and
 * three presses, kept apart from the journey above because none of them is
 * plan-gated: a lapsed subscription must never close an organization's own
 * recovery path.
 */
export interface SsoBreakGlassLedger {
  findGrants(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassGrant[]>;
  findCandidates(input: SsoSetupOrganizationInput): Promise<SsoBreakGlassCandidate[]>;
  /** The grantor is the actor, never an argument — one is never self-served. */
  grant(
    input: { organizationId: string; userId: string; expiresAtMs: number },
    actor: SsoSelfServeActor,
  ): Promise<SsoBreakGlassBinding>;
  /** Writes a NEW grant naming the old, so the date the previous one ended
   *  stays readable. */
  renew(
    input: { organizationId: string; bindingId: string; expiresAtMs: number },
    actor: SsoSelfServeActor,
  ): Promise<SsoBreakGlassRenewal>;
  /** Ends one now. Refused while it is a live connection's only way back in. */
  revoke(input: SsoBreakGlassBindingInput): Promise<SsoBreakGlassBinding>;
}

/**
 * Where the gate says what it decided. An operator whose single sign-on is off
 * reads these lines to learn why, so the process supplies its own logger.
 */
export interface SsoGateLogger {
  info(context: object, message: string): void;
  warn(context: object, message: string): void;
}

/** The one line the history signal ever writes: a poll that could not read. */
export type SsoActivityLogger = Pick<SsoGateLogger, "warn">;

/**
 * Identity's own folding of where the setup stands — everything the page
 * reads except the addresses this module serves, which is the half it adds.
 * Demanded as exactly that half, so a field identity stops answering stops
 * this from compiling rather than reaching a screen as undefined.
 */
export type SsoSetupJourney = Omit<SsoSetupPageView, "serviceProvider">;

export interface SsoSetupReads {
  getSetup(input: SsoSetupOrganizationInput): Promise<SsoSetupJourney>;
  /** One cutover's members, paged. The migration is null where the
   *  organization is running none, or where the connection named is not the
   *  replacement in one. */
  getMigrationProgress(
    input: SsoSetupMigrationProgressInput,
  ): Promise<{ migration: SsoSetupMigration | null }>;
}

/**
 * The organization's own read of its connection's history. Identity owns the
 * facts and the words; this is the one call the administrator's page makes.
 */
export interface SsoConnectionHistoryReads {
  getHistory(input: {
    organizationId: string;
    connectionId: string;
    limit?: number;
  }): Promise<
    readonly { eventId: string; occurredAtMs: number; summary: string; carriedOver: boolean }[]
  >;
}
