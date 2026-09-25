import { moduleApi } from "@langwatch/kernel/module-api";
import type { SystemMigration } from "@langwatch/system-migrations";

import type {
  AccountIdentifier,
  EmailIdentifierAdded,
  MethodsLastUsed,
} from "./account-identifiers.ts";
import type {
  BreakGlassBinding,
  BreakGlassCandidateView,
  BreakGlassGrantView,
} from "./break-glass.ts";
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
import type { IdentityEmailResolution } from "./identity-email.service.ts";
import type { DomainJoinSetting, JoinLookupDecision, JoinOffer } from "./join-matching.ts";
import type {
  ApproveJoinCommandData,
  ExpireJoinCommandData,
  RejectJoinCommandData,
  RequestJoinCommandData,
  WithdrawJoinCommandData,
} from "./join-request-commands.ts";
import type { JoinRequestAggregateState, JoinRequestFactInput } from "./join-request.ts";
import type { VerifiedEmailsResolution } from "./matchable-emails.ts";
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
  RedriveScimApplyCommandData,
  RevokeScimSyncCommandData,
} from "./scim-sync-commands.ts";
import type { ScimSyncFactInput, ScimSyncState } from "./scim-sync.ts";
import type { RoutingDecision } from "./signin-routing.ts";
import type {
  SsoArrivingUser,
  SsoAssertionDecision,
  SsoTestArrivalStanding,
} from "./sso-admission.ts";
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
import type {
  SsoMigrationAccountLinkDecision,
  SsoMigrationAuthenticationDecision,
  SsoMigrationView,
} from "./sso-migration.ts";
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
  /** What one of the organization's connections speaks to. Asked by a peer
   *  holding rows stamped with the provider rather than the connection, so it
   *  never has to be told a name identity owns. */
  getProvider(args: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoConnectionProviderReading>;
  /** Which organization governs a connection. Asked by the peer that holds
   *  only the connection the sign-in router chose. Throws when no connection
   *  answers to that id. */
  getOrganization(args: { connectionId: string }): Promise<{ organizationId: string }>;
}

/** One connection, named the way the rows a peer owns were stamped. */
export interface SsoConnectionProviderReading {
  connectionId: string;
  providerId: string;
}

/**
 * Where each of an organization's directory syncs stands. Identity owns the
 * folded state; the directory module composes its reconciliation view from
 * this plus the people it pushed itself.
 */
export interface ScimSyncReadsApi {
  findForOrganization(args: { organizationId: string }): Promise<ScimSyncState[]>;
  /** One connection's sync, or null where that connection has never synced.
   *  Scoped to the organization, so a caller cannot read another's. */
  findByConnection(args: {
    organizationId: string;
    connectionId: string;
  }): Promise<ScimSyncState | null>;
  /** The platform operator's cross-customer page (ADR-122), newest first;
   *  searched on the sync, connection or organization id, or the state. */
  listForOperator(args: {
    page: number;
    pageSize: number;
    search?: string | undefined;
  }): Promise<{ syncs: ScimSyncState[]; total: number }>;
  /** One connection's sync across every organization, for the operator. */
  findForOperator(args: { connectionId: string }): Promise<ScimSyncState[]>;
}

/**
 * The issuers registered connections speak to, keyed the two ways a sign-in
 * request can name one. Registering an issuer IS the declaration that this
 * installation may talk to that address (ADR-117 §5).
 */
export interface SsoIssuerDirectoryApi {
  findIssuersForConnection(args: { connectionId: string }): Promise<string[]>;
  /** The issuer of the connection that proved this domain. Empty where the
   *  domain is unproved, or its connection is not one anybody may dial. */
  findIssuersForDomain(args: { domain: string }): Promise<string[]>;
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
    evidenceRef: string;
    note: string;
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
 * The way back in (D05, ADR-117 §5): a named person who can still sign in
 * when the identity provider cannot. Never plan-gated, and never
 * self-served — the grantor is the actor, never an argument.
 */
export interface SsoBreakGlassApi {
  /** Every grant the organization has held, newest rows included, with who
   *  holds each one. */
  findGrants(args: { organizationId: string }): Promise<BreakGlassGrantView[]>;
  /** Who one can be granted to: the organization's administrators. */
  findCandidates(args: { organizationId: string }): Promise<BreakGlassCandidateView[]>;
  grant(args: {
    organizationId: string;
    userId: string;
    actor: SelfServeActor;
    expiresAtMs: number;
  }): Promise<BreakGlassBinding>;
  /** Extends one by writing a new grant that names the old, so the date the
   *  previous one ended stays readable. */
  renew(args: {
    organizationId: string;
    bindingId: string;
    actor: SelfServeActor;
    expiresAtMs: number;
  }): Promise<{ renewed: BreakGlassBinding; replaced: BreakGlassBinding }>;
  /** Ends one now. Refused while it is a live connection's only way back in. */
  revoke(args: { organizationId: string; bindingId: string }): Promise<BreakGlassBinding>;
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
  /** Finishes the cutover: refused by name while anything still says it is
   *  premature, and resumable after an interrupted attempt. */
  finalizeLegacyMigration(args: SsoSetupCommand): Promise<void>;
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
  /**
   * Whether the way in this callback used still authenticates, asked once the
   * person is known and before the session exists. Records the sign-in against
   * the connection it belongs to, which is what a cutover counts stragglers by.
   */
  authorizeAndRecordAuthentication(args: {
    userId: string;
    /** better-auth's own endpoint path, which names the callback. */
    callbackPath: string | undefined;
    /** The federated accounts this person holds, from the module that owns
     *  them: identity decides, auth supplies its own rows. */
    accounts: readonly { providerId: string; accountId: string }[];
  }): Promise<SsoMigrationAuthenticationDecision>;
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
  admit(args: SsoArrivalAdmission): Promise<void>;
}

/** One arrival a connection admits: who arrived, through which connection and domain. */
export type SsoArrivalAdmission = { user: SsoArrivingUser; connectionId: string; domain: string };

/** A member a matching domain admitted, and whether the policy did it with nobody approving. */
export interface IdentityDomainAdmission {
  userId: string;
  domain: string;
  automatic: boolean;
}

/** Which of an organization's members joined by domain (D12), for the members list. */
export interface JoinAdmissionsApi {
  findForMembers(args: {
    organizationId: string;
    userIds: readonly string[];
  }): Promise<IdentityDomainAdmission[]>;
}

/** Both values and both domain lists of a saved joining setting, for its audit row. */
export interface JoinSettingChange {
  previous: DomainJoinSetting;
  next: DomainJoinSetting;
  previousDomains: readonly string[];
  nextDomains: readonly string[];
}

/**
 * The join-request ledger (D12, ADR-117): the lookup, the offer, the ask, the
 * admins' answers and the setting behind them. Organization serves the door.
 */
export interface JoinRequestsApi {
  lookup(args: { userId: string; verifiedEmail: string | null }): Promise<JoinLookupDecision>;
  offerForSignedInUser(args: {
    userId: string;
    verifiedEmail: string | null;
  }): Promise<JoinLookupDecision>;
  dismissOffer(args: { userId: string; verifiedEmail: string | null }): Promise<void>;
  joinAutomaticallyIfAdmitted(args: {
    userId: string;
    verifiedEmail: string | null;
  }): Promise<{ organization: JoinOffer | null }>;
  request(args: {
    userId: string;
    verifiedEmail: string | null;
    organizationId: string;
  }): Promise<{ joinRequestId: string; state: "PENDING" | "APPROVED" }>;
  withdraw(args: { joinRequestId: string; userId: string }): Promise<void>;
  approve(args: {
    joinRequestId: string;
    organizationId: string;
    adminUserId: string;
  }): Promise<void>;
  reject(args: {
    joinRequestId: string;
    organizationId: string;
    adminUserId: string;
  }): Promise<void>;
  resolveByInvitation(args: {
    userId: string;
    organizationId: string;
    inviteId: string;
  }): Promise<void>;
  withdrawOnInvitationAccepted(args: { userId: string; organizationId: string }): Promise<void>;
  /** Audited against `actorUserId`, the administrator who saved it. */
  setJoining(args: {
    organizationId: string;
    domainJoin: DomainJoinSetting;
    domains: readonly string[];
    actorUserId: string;
  }): Promise<JoinSettingChange>;
  readJoining(args: {
    organizationId: string;
  }): Promise<{ domainJoin: DomainJoinSetting; joinDomains: string[] }>;
  pendingForOrganization(args: { organizationId: string }): Promise<JoinRequestAggregateState[]>;
  automaticJoinsForOrganization(args: {
    organizationId: string;
  }): Promise<JoinRequestAggregateState[]>;
  pendingForUser(args: { userId: string }): Promise<JoinRequestAggregateState[]>;
}

/**
 * Where a person who belongs to no organization stands: not testing anything,
 * for almost everybody — and the connection an administrator's mandatory test
 * sign-in went through, which happened before it could admit anybody.
 */
export interface SsoTestArrivalApi {
  standingFor(args: { userId: string }): Promise<SsoTestArrivalStanding>;
}

/** The directory-sync guards. */
export interface ScimSyncGuardsApi {
  issueScimToken(data: IssueScimTokenCommandData): Promise<ScimSyncFactInput[]>;
  recordScimUserPush(data: RecordScimUserPushCommandData): Promise<ScimSyncFactInput[]>;
  recordScimGroupMapping(data: RecordScimGroupMappingCommandData): Promise<ScimSyncFactInput[]>;
  recordScimApplyFailure(data: RecordScimApplyFailureCommandData): Promise<ScimSyncFactInput[]>;
  redriveScimApply(data: RedriveScimApplyCommandData): Promise<ScimSyncFactInput[]>;
  revokeScimSync(data: RevokeScimSyncCommandData): Promise<ScimSyncFactInput[]>;
}

/** The address-lock reservations the identity ledger claims and releases. */
export interface IdentityReservationsApi {
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
}

/**
 * The capabilities identity publishes across a package boundary today: email
 * fork read, guard services, address-lock reservations, newborn
 * reconciliation, user-migration registry, SSO backoffice connection writer.
 */
export interface IdentityApi {
  /** The identifier-backed address, or `keep_legacy` for legacy `User.email` holders. */
  resolveEmail(input: { userId: string }): Promise<IdentityEmailResolution>;
  /** Every proven address, or `keep_legacy` for legacy `User.email` holders. */
  verifiedEmailsOf(input: { userId: string }): Promise<VerifiedEmailsResolution>;
  /** Completes the session user's PKCE-bound, single-use email verification ceremony. */
  completeEmailVerification(input: {
    userId: string;
    identifierId: string;
    verificationId: string;
    token: string;
    codeVerifier: string;
  }): Promise<void>;
  /** Every live way into the account, with what the detach guard would say about losing each. */
  listAccountIdentifiers(input: { userId: string }): Promise<AccountIdentifier[]>;
  /** Attaches an address unverified and mails its confirmation link; 10 an hour per user. */
  addEmailIdentifier(input: {
    userId: string;
    email: string;
    codeChallenge: string;
  }): Promise<EmailIdentifierAdded>;
  /** A fresh confirmation ceremony for an unconfirmed address; 10 an hour per user. */
  resendIdentifierConfirmation(input: {
    userId: string;
    identifierId: string;
    codeChallenge: string;
  }): Promise<void>;
  /** Gives up a way in, demoting a primary first; the detach guard decides. */
  removeIdentifier(input: { userId: string; identifierId: string }): Promise<void>;
  /** When each sign-in method last minted a session, read from the user's sessions. */
  getMethodsLastUsed(input: { userId: string }): Promise<MethodsLastUsed>;
  /** Where an address signs in; `breakGlass` asks for the rate-limited local door (ADR-117). */
  routeSignIn(
    input: Readonly<{ identifier: string | null; breakGlass: boolean }>,
  ): Promise<RoutingDecision>;
  /** Operations, not properties: a module boundary carries callable members only. */
  guards(): IdentityGuardsApi;
  mfaGuards(): MfaGuardsApi;
  reservations(): IdentityReservationsApi;
  identity(): IdentityLedgerApi;
  newbornSweep(): IdentityNewbornSweepApi;
  /** The USER-rooted migration registry (ADR-101 §6), in main's order. */
  userMigrations(): readonly SystemMigration[];
  joinRequestGuards(): JoinRequestGuardsApi;
  ssoConnections(): SsoConnectionApi;
  ssoConnectionGuards(): SsoConnectionGuardsApi;
  ssoBackoffice(): SsoConnectionBackofficeApi;
  ssoConnectionHistory(): SsoConnectionHistoryApi;
  ssoConnectionReads(): SsoConnectionReadsApi;
  ssoIssuers(): SsoIssuerDirectoryApi;
  ssoDomainCeremony(): SsoDomainCeremonyApi;
  ssoDomainReproof(): SsoDomainReproofApi;
  ssoAssertion(): SsoAssertionApi;
  ssoArrival(): SsoArrivalApi;
  ssoTestArrival(): SsoTestArrivalApi;
  joinAdmissions(): JoinAdmissionsApi;
  joinRequests(): JoinRequestsApi;
  ssoActivity(): SsoAuthenticationActivityApi;
  ssoMigrationCallbacks(): SsoMigrationCallbackApi;
  ssoBreakGlass(): SsoBreakGlassApi;
  ssoSetup(): SsoSetupApi;
  ssoSetupCommands(): SsoSetupCommandsApi;
  scimSyncGuards(): ScimSyncGuardsApi;
  scimSyncReads(): ScimSyncReadsApi;
}

export const IdentityApi = moduleApi<IdentityApi>()("identity");
