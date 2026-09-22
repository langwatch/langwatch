import { moduleApi } from "@langwatch/kernel/module-api";
import type { SystemMigration } from "@langwatch/system-migrations";

import type {
  ActivateConnectionCommandData,
  ApproveDomainClaimCommandData,
  AttestDomainCommandData,
  ClaimDomainCommandData,
  CompleteTeardownCommandData,
  DiscardConnectionCommandData,
  GrandfatherConnectionCommandData,
  RegisterConnectionCommandData,
  RejectDomainClaimCommandData,
  RequestTeardownCommandData,
  RequestVerificationCommandData,
  ResumeConnectionCommandData,
  SuspendConnectionCommandData,
  VerifyDomainCommandData,
} from "./connection-commands.ts";
import type {
  SsoArrivalPolicy,
  SsoConnectionFactInput,
  SsoConnectionLifecycleState,
  SsoDomainVerification,
  SsoMigrationRoute,
} from "./connection.ts";
import type {
  AttachIdentifierCommandData,
  DetachIdentifierCommandData,
  EraseUserCommandData,
  IdentityFact,
  IdentityFactInput,
  MarkPrimaryCommandData,
  ProposeLinkCommandData,
  VerifyIdentifierCommandData,
} from "./facts.ts";
import type {
  ApproveJoinCommandData,
  ExpireJoinCommandData,
  RejectJoinCommandData,
  RequestJoinCommandData,
  WithdrawJoinCommandData,
} from "./join-request-commands.ts";
import type { JoinRequestFactInput } from "./join-request.ts";
import type { MatchableEmail } from "./matchable-emails.ts";
import type {
  ConfirmMfaCommandData,
  ConsumeBackupCodeCommandData,
  DisableMfaCommandData,
  EnrollMfaCommandData,
  ExpireMfaEnrollmentCommandData,
  RecordMfaVerificationFailureCommandData,
  RegenerateBackupCodesCommandData,
  MfaFactInput,
} from "./mfa.ts";
import type {
  IssueScimTokenCommandData,
  RecordScimApplyFailureCommandData,
  RecordScimGroupMappingCommandData,
  RecordScimUserPushCommandData,
  RevokeScimSyncCommandData,
} from "./scim-sync-commands.ts";
import type { ScimSyncFactInput } from "./scim-sync.ts";
import type { SsoArrivingUser, SsoAssertionDecision } from "./sso-admission.ts";
import type {
  OrganizationSsoConnection,
  SsoConnectionHistoryEntryView,
} from "./sso-connection-history.ts";
import type {
  SelfServeActor,
  SelfServeIssuedDnsRecord,
  SsoDomainReproofOutcome,
} from "./sso-domain-proof.ts";
import type { SsoIdpRegistration } from "./sso-idp-registration.ts";
import type { SsoMigrationAccountLinkDecision, SsoMigrationView } from "./sso-migration.ts";
import type { SsoConnectionRemoval, SsoSetupCommand, SsoSetupView } from "./sso-setup.ts";

/** One abandoned-newborn sweep pass (ADR-116 §3). */
export interface IdentityNewbornSweepSummary {
  examined: number;
  erased: number;
  failed: number;
  locksReaped: number;
}

/** The operator issuing a backoffice SSO command, as the surface knows them. */
export interface IdentityOperatorActor {
  userId: string;
}

/** One SSO connection, shaped for the backoffice read surface. */
export interface IdentityBackofficeSsoConnection {
  connectionId: string;
  organizationId: string;
  organizationName: string | null;
  type: string;
  state: SsoConnectionLifecycleState;
  claimedDomains: string[];
  approvedDomains: string[];
  verifiedDomains: string[];
  /** What proved each domain. Not its ADR-123 condition: the back-office
   *  surface does not carry one yet. */
  domainVerifications: Pick<
    SsoDomainVerification,
    "domain" | "method" | "actorId" | "verifiedAtMs"
  >[];
  providerId: string;
  issuer: string | null;
  /** Who the connection admits, as the aggregate holds it. */
  arrivalPolicy: SsoArrivalPolicy;
  /** DERIVED from the arrival policy: `admit` and nothing else. Kept beside
   *  it for one release, for readers written before the policy existed. */
  allowsJit: boolean;
  source: string;
  testLoginAccountId: string | null;
  rejection: { domain: string; note: string } | null;
  pendingVerificationDomain: string | null;
  /** When the ceremony in flight stops proving anything; null when none is
   *  in flight, or when it does not expire. */
  pendingVerificationExpiresAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface IdentityBackofficeSsoConnectionList {
  connections: IdentityBackofficeSsoConnection[];
  total: number;
}

/** The identity guards: heads, users and the address lock (ADR-116 §6). */
export interface IdentityGuardsApi {
  attachIdentifier(data: AttachIdentifierCommandData): Promise<IdentityFactInput[]>;
  verifyIdentifier(data: VerifyIdentifierCommandData): Promise<IdentityFactInput[]>;
  markPrimary(data: MarkPrimaryCommandData): Promise<IdentityFactInput[]>;
  detachIdentifier(data: DetachIdentifierCommandData): Promise<IdentityFactInput[]>;
  eraseUser(data: EraseUserCommandData): Promise<IdentityFactInput[]>;
  proposeLink(data: ProposeLinkCommandData): Promise<IdentityFactInput[]>;
}

/** The MFA enrolment guards. */
export interface MfaGuardsApi {
  enrollMfa(data: EnrollMfaCommandData): Promise<MfaFactInput[]>;
  confirmMfa(data: ConfirmMfaCommandData): Promise<MfaFactInput[]>;
  expireMfaEnrollment(data: ExpireMfaEnrollmentCommandData): Promise<MfaFactInput[]>;
  disableMfa(data: DisableMfaCommandData): Promise<MfaFactInput[]>;
  consumeBackupCode(data: ConsumeBackupCodeCommandData): Promise<MfaFactInput[]>;
  regenerateBackupCodes(data: RegenerateBackupCodesCommandData): Promise<MfaFactInput[]>;
  recordVerificationFailure(data: RecordMfaVerificationFailureCommandData): Promise<MfaFactInput[]>;
}

/** The one identifier write surface every ledger command stages through. */
export interface IdentityLedgerApi {
  attachIdentifier(input: AttachIdentifierCommandData): Promise<IdentityFact[]>;
  verifyIdentifier(input: VerifyIdentifierCommandData): Promise<IdentityFact[]>;
  markPrimary(input: MarkPrimaryCommandData): Promise<IdentityFact[]>;
  detachIdentifier(input: DetachIdentifierCommandData): Promise<IdentityFact[]>;
  eraseUser(input: EraseUserCommandData): Promise<IdentityFact[]>;
  proposeLink(input: ProposeLinkCommandData): Promise<IdentityFact[]>;
}

/** The abandoned-newborn sweep (ADR-116 §3). */
export interface IdentityNewbornSweepApi {
  runPass(): Promise<IdentityNewbornSweepSummary>;
}

/** The join-request read guards. */
export interface JoinRequestGuardsApi {
  requestJoin(data: RequestJoinCommandData): Promise<JoinRequestFactInput[]>;
  approveJoin(data: ApproveJoinCommandData): Promise<JoinRequestFactInput[]>;
  rejectJoin(data: RejectJoinCommandData): Promise<JoinRequestFactInput[]>;
  withdrawJoin(data: WithdrawJoinCommandData): Promise<JoinRequestFactInput[]>;
  expireJoin(data: ExpireJoinCommandData): Promise<JoinRequestFactInput[]>;
}

/** The two wake-driven join-request mails. */
export interface JoinRequestNotificationApi {
  requestStillWaiting(args: { joinRequestId: string; organizationId: string }): Promise<void>;
  requestExpired(args: {
    joinRequestId: string;
    organizationId: string;
    requesterUserId: string;
  }): Promise<void>;
}

/** The SSO connection write guards. */
export interface SsoConnectionGuardsApi {
  registerConnection(data: RegisterConnectionCommandData): Promise<SsoConnectionFactInput[]>;
  grandfatherConnection(data: GrandfatherConnectionCommandData): Promise<SsoConnectionFactInput[]>;
  claimDomain(data: ClaimDomainCommandData): Promise<SsoConnectionFactInput[]>;
  approveDomainClaim(data: ApproveDomainClaimCommandData): Promise<SsoConnectionFactInput[]>;
  rejectDomainClaim(data: RejectDomainClaimCommandData): Promise<SsoConnectionFactInput[]>;
  discardConnection(data: DiscardConnectionCommandData): Promise<SsoConnectionFactInput[]>;
  requestVerification(data: RequestVerificationCommandData): Promise<SsoConnectionFactInput[]>;
  attestDomain(data: AttestDomainCommandData): Promise<SsoConnectionFactInput[]>;
  verifyDomain(data: VerifyDomainCommandData): Promise<SsoConnectionFactInput[]>;
  activateConnection(data: ActivateConnectionCommandData): Promise<SsoConnectionFactInput[]>;
  suspendConnection(data: SuspendConnectionCommandData): Promise<SsoConnectionFactInput[]>;
  resumeConnection(data: ResumeConnectionCommandData): Promise<SsoConnectionFactInput[]>;
  requestTeardown(data: RequestTeardownCommandData): Promise<SsoConnectionFactInput[]>;
  completeTeardown(data: CompleteTeardownCommandData): Promise<SsoConnectionFactInput[]>;
}

/** The one SSO connection write surface an operator and the pipeline share. */
export interface SsoConnectionApi {
  registerConnection(input: RegisterConnectionCommandData): Promise<unknown[]>;
  claimDomain(input: ClaimDomainCommandData): Promise<unknown[]>;
  approveDomainClaim(input: ApproveDomainClaimCommandData): Promise<unknown[]>;
  rejectDomainClaim(input: RejectDomainClaimCommandData): Promise<unknown[]>;
  discardConnection(input: DiscardConnectionCommandData): Promise<unknown[]>;
  requestVerification(input: RequestVerificationCommandData): Promise<unknown[]>;
  attestDomain(input: AttestDomainCommandData): Promise<unknown[]>;
  verifyDomain(input: VerifyDomainCommandData): Promise<unknown[]>;
  activateConnection(input: ActivateConnectionCommandData): Promise<unknown[]>;
  suspendConnection(input: SuspendConnectionCommandData): Promise<unknown[]>;
  resumeConnection(input: ResumeConnectionCommandData): Promise<unknown[]>;
  requestTeardown(input: RequestTeardownCommandData): Promise<unknown[]>;
  completeTeardown(input: CompleteTeardownCommandData): Promise<unknown[]>;
  grandfatherConnection(input: GrandfatherConnectionCommandData): Promise<unknown[]>;
}

/**
 * The SSO connections an organization holds, read by a peer module. Identity
 * owns these rows; nobody else queries them.
 */
export interface SsoConnectionReadsApi {
  findForOrganization(args: { organizationId: string }): Promise<OrganizationSsoConnection[]>;
}

/**
 * One connection's own history, in words. Both the organization's page and
 * the back office read through this: who may reach it is the transport's
 * question, and the organization it is scoped to the caller's.
 */
export interface SsoConnectionHistoryApi {
  getHistory(args: {
    organizationId: string;
    connectionId: string;
    limit?: number;
  }): Promise<SsoConnectionHistoryEntryView[]>;
}

/** The backoffice read/write surface over SSO connections. */
export interface SsoConnectionBackofficeApi {
  list(args: {
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<IdentityBackofficeSsoConnectionList>;
  findById(args: { connectionId: string }): Promise<IdentityBackofficeSsoConnection | null>;
  /** One connection's history, the organization resolved from the connection
   *  rather than taken from the caller. Null for one that does not exist. */
  findHistory(args: {
    connectionId: string;
    limit?: number;
  }): Promise<SsoConnectionHistoryEntryView[] | null>;
  registerConnection(args: {
    organizationId: string;
    type: string;
    providerId: string;
    issuer: string | null;
    /** The legacy boolean, read only when no policy was stated. */
    allowsJit: boolean;
    arrivalPolicy?: SsoArrivalPolicy;
    operator: IdentityOperatorActor;
  }): Promise<{ connectionId: string }>;
  claimDomain(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
    domain: string;
  }): Promise<void>;
  approveDomainClaim(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
    domain: string;
  }): Promise<void>;
  rejectDomainClaim(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
    domain: string;
    note: string;
  }): Promise<void>;
  attestDomain(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
    domain: string;
  }): Promise<void>;
  activateConnection(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
    testLoginAccountId: string;
  }): Promise<void>;
  suspendConnection(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
    reason: string | null;
  }): Promise<void>;
  resumeConnection(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
  }): Promise<void>;
  requestTeardown(args: {
    organizationId: string;
    connectionId: string;
    operator: IdentityOperatorActor;
    reason: string | null;
    graceMs: number;
  }): Promise<void>;
}

/** One domain, on one connection, at one administrator's hand. */
export interface SsoDomainCeremonyCommand {
  organizationId: string;
  connectionId: string;
  domain: string;
  actor: SelfServeActor;
}

/**
 * The domain ceremony an administrator runs themselves (ADR-123, D05 tier 3).
 * A claim somebody else already proved waits for a person; everything else is
 * decided by what the domain publishes.
 */
export interface SsoDomainCeremonyApi {
  claimDomain(
    command: SsoDomainCeremonyCommand,
  ): Promise<{ waitsForReview: boolean; disputed: boolean }>;
  /** The record to publish, with its value answered once. */
  proveDomain(
    command: SsoDomainCeremonyCommand,
  ): Promise<{ proved: true } | { proved: false; record: SelfServeIssuedDnsRecord }>;
  checkDomainRecord(command: SsoDomainCeremonyCommand): Promise<{ proved: true }>;
  checkDomainFile(command: SsoDomainCeremonyCommand): Promise<{ proved: true }>;
  /** Takes a domain back out. Refused for a VERIFIED domain on a connection
   *  that is deciding sign-in — that connection is removed, not tidied. */
  removeDomain(command: SsoDomainCeremonyCommand): Promise<void>;
}

/**
 * The re-proof sweep (ADR-123): one pass over the domains proved by a
 * published record or file, re-read where that evidence lives.
 */
export interface SsoDomainReproofApi {
  sweep(): Promise<SsoDomainReproofOutcome>;
}

/**
 * Where one organization's setup journey stands (D05, ADR-123). A read: every
 * verb the journey presses is a command on one of the surfaces above.
 */
export interface SsoSetupApi {
  getSetup(args: { organizationId: string }): Promise<SsoSetupView>;
  /** One organization's cutover, paged: `getSetup` carries the first page of
   *  stragglers, and this is how the section asks for the rest. `migration`
   *  is null when the organization is running none. */
  getMigrationProgress(args: {
    organizationId: string;
    connectionId?: string;
    cursor: string | null;
    limit: number;
  }): Promise<{ migration: SsoMigrationView | null }>;
}

/**
 * The verbs the setup journey presses. Every one names the administrator it
 * is for; none of them takes an actor the caller made up.
 */
export interface SsoSetupCommandsApi {
  register(args: {
    organizationId: string;
    actor: SelfServeActor;
    /** What the administrator calls this provider. */
    providerId: string;
    registration: SsoIdpRegistration;
  }): Promise<{ connectionId: string }>;
  /** The direct replacement for a grandfathered connection, carrying over
   *  the domains it has already proved. */
  startLegacyMigration(args: {
    organizationId: string;
    actor: SelfServeActor;
    legacyConnectionId: string;
    providerId: string;
    registration: SsoIdpRegistration;
  }): Promise<{ connectionId: string }>;
  /** Which of a migration pair decides ordinary sign-ins. */
  selectMigrationRoute(args: SsoSetupCommand & { route: SsoMigrationRoute }): Promise<void>;
  /** The word on the card; nothing routes on it. */
  rename(args: SsoSetupCommand & { name: string }): Promise<void>;
  setArrivals(args: SsoSetupCommand & { arrivalPolicy: SsoArrivalPolicy }): Promise<void>;
  /** Takes the connection live on the strength of the test sign-in it
   *  recorded: the account is resolved here, never supplied by a caller. */
  activate(args: SsoSetupCommand): Promise<void>;
  discardConnection(args: SsoSetupCommand): Promise<void>;
  /** Which removal this is comes from where the connection stands. */
  removeConnection(
    args: SsoSetupCommand & { reason: string | null; graceMs: number },
  ): Promise<{ removal: SsoConnectionRemoval }>;
}

/**
 * Whether an assertion may become a session at all — asked BEFORE anything
 * links it to a person, because deciding membership first was an account
 * takeover (ADR-117 §5).
 */
export interface SsoAssertionApi {
  decide(args: {
    providerId: string;
    accountId?: string;
    email: string | null | undefined;
  }): Promise<SsoAssertionDecision>;
}

/**
 * Which connection a callback belongs to while an organization is cutting
 * over. Asked before the account row is written, because a pair's two sides
 * are two providers for one person and the arrival has to name the right one.
 */
export interface SsoMigrationCallbackApi {
  decideAccountLink(args: {
    userId: string;
    account: { providerId: string; accountId: string };
    /** The other federated accounts this person holds, from the module that
     *  owns them: identity decides, auth supplies its own rows. */
    otherAccounts: readonly { providerId: string; accountId: string }[];
  }): Promise<SsoMigrationAccountLinkDecision>;
}

/**
 * The trail a connection's sign-ins leave. Asked by whoever hosts the
 * sign-in door, which knows the provider and the person and nothing else:
 * a provider naming no connection records nothing.
 */
export interface SsoAuthenticationActivityApi {
  record(args: {
    connectionId: string;
    userId: string;
    /** The subject the provider asserted, when the door knew it. */
    providerAccountId?: string | null;
  }): Promise<void>;
}

/**
 * What a connection's arrival answer does once the session exists. The
 * account and session are already committed, so an admission that fails is
 * reported, never turned into a refused sign-in.
 */
export interface SsoArrivalApi {
  admit(args: { user: SsoArrivingUser; connectionId: string; domain: string }): Promise<void>;
}

/** The directory-sync guards. */
export interface ScimSyncGuardsApi {
  issueScimToken(data: IssueScimTokenCommandData): Promise<ScimSyncFactInput[]>;
  recordScimUserPush(data: RecordScimUserPushCommandData): Promise<ScimSyncFactInput[]>;
  recordScimGroupMapping(data: RecordScimGroupMappingCommandData): Promise<ScimSyncFactInput[]>;
  recordScimApplyFailure(data: RecordScimApplyFailureCommandData): Promise<ScimSyncFactInput[]>;
  revokeScimSync(data: RevokeScimSyncCommandData): Promise<ScimSyncFactInput[]>;
}

/**
 * The capabilities identity publishes across a package boundary today: email
 * fork read, guard services, address-lock reservations, newborn
 * reconciliation, user-migration registry, SSO backoffice connection writer.
 */
export interface IdentityApi {
  /** Gets the identifier-backed address for this user, or null for legacy `User.email` holders. */
  findEmail(input: { userId: string }): Promise<string | null>;
  /** Gets every verified address this user has proven, or null for legacy `User.email` holders. */
  verifiedEmailsOf(input: { userId: string }): Promise<MatchableEmail[] | null>;
  /** Completes the session user's PKCE-bound, single-use email verification ceremony. */
  completeEmailVerification(input: {
    userId: string;
    identifierId: string;
    verificationId: string;
    token: string;
    codeVerifier: string;
  }): Promise<void>;
  /** Operations, not properties: a module boundary carries callable members only. */
  guards(): IdentityGuardsApi;
  mfaGuards(): MfaGuardsApi;
  reservations(): {
    claim(args: {
      normalizedValue: string;
      userId: string;
      identifierId: string;
      commandId: string;
    }): Promise<{
      normalizedValue: string;
      userId: string;
      identifierId: string;
      commandId: string;
    }>;
    release(args: { userId: string; holdingIdentifierIds: readonly string[] }): Promise<number>;
    reapOrphans(): Promise<number>;
  };
  identity(): IdentityLedgerApi;
  newbornSweep(): IdentityNewbornSweepApi;
  /** The USER-rooted migration registry (ADR-101 §6), in main's order. */
  userMigrations(): readonly SystemMigration[];
  joinRequestGuards(): JoinRequestGuardsApi;
  joinRequestNotifications(): JoinRequestNotificationApi | null;
  ssoConnections(): SsoConnectionApi;
  ssoConnectionGuards(): SsoConnectionGuardsApi;
  ssoBackoffice(): SsoConnectionBackofficeApi;
  ssoConnectionHistory(): SsoConnectionHistoryApi;
  ssoConnectionReads(): SsoConnectionReadsApi;
  ssoDomainCeremony(): SsoDomainCeremonyApi;
  ssoDomainReproof(): SsoDomainReproofApi;
  ssoAssertion(): SsoAssertionApi;
  ssoArrival(): SsoArrivalApi;
  ssoActivity(): SsoAuthenticationActivityApi;
  ssoMigrationCallbacks(): SsoMigrationCallbackApi;
  ssoSetup(): SsoSetupApi;
  ssoSetupCommands(): SsoSetupCommandsApi;
  scimSyncGuards(): ScimSyncGuardsApi;
}

export const IdentityApi = moduleApi<IdentityApi>()("identity");
