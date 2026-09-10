import { moduleApi } from "@langwatch/runtime-composition";
import type { SystemMigration } from "@langwatch/system-migrations";
import type { MatchableEmail } from "./matchable-emails.ts";
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
import type {
  ConfirmMfaCommandData,
  ConsumeBackupCodeCommandData,
  DisableMfaCommandData,
  EnrollMfaCommandData,
  ExpireMfaEnrollmentCommandData,
  RecordMfaVerificationFailureCommandData,
  RegenerateBackupCodesCommandData,
} from "./mfa.ts";
import type { MfaFactInput } from "./mfa.ts";
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
import type { SsoConnectionFactInput, SsoDomainVerification, SsoConnectionLifecycleState } from "./connection.ts";
import type {
  IssueScimTokenCommandData,
  RecordScimApplyFailureCommandData,
  RecordScimGroupMappingCommandData,
  RecordScimUserPushCommandData,
  RevokeScimSyncCommandData,
} from "./scim-sync-commands.ts";
import type { ScimSyncFactInput } from "./scim-sync.ts";

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
  domainVerifications: SsoDomainVerification[];
  providerId: string;
  issuer: string | null;
  allowsJit: boolean;
  source: string;
  testLoginAccountId: string | null;
  rejection: { domain: string; note: string } | null;
  pendingVerificationDomain: string | null;
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

/** The backoffice read/write surface over SSO connections. */
export interface SsoConnectionBackofficeApi {
  list(args: { page: number; pageSize: number; search?: string }): Promise<IdentityBackofficeSsoConnectionList>;
  findById(args: { connectionId: string }): Promise<IdentityBackofficeSsoConnection | null>;
  registerConnection(args: {
    organizationId: string;
    type: string;
    providerId: string;
    issuer: string | null;
    allowsJit: boolean;
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

/** The directory-sync guards. */
export interface ScimSyncGuardsApi {
  issueScimToken(data: IssueScimTokenCommandData): Promise<ScimSyncFactInput[]>;
  recordScimUserPush(data: RecordScimUserPushCommandData): Promise<ScimSyncFactInput[]>;
  recordScimGroupMapping(data: RecordScimGroupMappingCommandData): Promise<ScimSyncFactInput[]>;
  recordScimApplyFailure(data: RecordScimApplyFailureCommandData): Promise<ScimSyncFactInput[]>;
  revokeScimSync(data: RevokeScimSyncCommandData): Promise<ScimSyncFactInput[]>;
}

/**
 * The capabilities identity publishes across a package boundary today: the
 * email fork read, the two guard services, the address-lock reservations,
 * the newborn reconciliation, the user-migration registry, and the SSO
 * backoffice connection writer.
 */
export interface IdentityApi {
  /** The identifier-backed address for this user, or null while they keep the legacy `User.email`. */
  findEmail(input: { userId: string }): Promise<string | null>;
  /** Every address this user has PROVEN, through any method (D11 invitation matching), or null while they keep the legacy `User.email`. */
  verifiedEmailsOf(input: { userId: string }): Promise<MatchableEmail[] | null>;
  /** Operations, not properties: a module boundary carries callable members only. */
  guards(): IdentityGuardsApi;
  mfaGuards(): MfaGuardsApi;
  reservations(): {
    claim(args: {
      normalizedValue: string;
      userId: string;
      identifierId: string;
      commandId: string;
    }): Promise<{ normalizedValue: string; userId: string; identifierId: string; commandId: string }>;
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
  scimSyncGuards(): ScimSyncGuardsApi;
}

export const IdentityApi = moduleApi<IdentityApi>("identity");
