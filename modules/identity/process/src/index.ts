/**
 * @langwatch/identity-process — the server-side runtime of the identity
 * platform (ADR-101, ADR-115): guards, services and crypto over the app's
 * heads/ledger/records ports. The pure half is `@langwatch/identity-contract`.
 */
export { identityProcessModule } from "./identity.module.ts";
export { SsoConnectionLedgerStore } from "./eventing/sso-connection-ledger.store.ts";
export type { SsoConnectionEvent } from "./eventing/sso-connection-state.projection.ts";
export type {
  DeriveIdentifierIdInput,
  IdentifierIdentity,
} from "./services/crypto-identifier-identity.service.ts";
export type {
  BackfillAccountRow,
  BackfillUserRow,
} from "./repositories/identity-backfill.repository.ts";
export type { PlannedIdentifier } from "./services/identity-backfill-plan.service.ts";
export type {
  IdentityBackfillOutcome,
  IdentityBackfillServiceDeps,
} from "./services/identity-backfill.service.ts";
export type { IdentityPipeline } from "./eventing/user-identity.pipeline.ts";
export type { JoinRequestPipeline } from "./eventing/join-request.pipeline.ts";
/** The day-7-reminder/day-14-expiry process manager's registered name, named
 *  by a caller that asserts on which process a wake dispatched through. */
/** The domain-proof notification process manager's registered name, and the
 *  seam a composition answers it with (ADR-123). */
export {
  SSO_DOMAIN_PROOF_NOTIFICATION_PROCESS_NAME,
  type SsoDomainProofNotifications,
} from "./eventing/sso-domain-proof-notification.process.ts";
export type { SsoDomainProofAudience } from "./services/sso-domain-proof-notification.service.ts";
export type {
  AccountSecretPair,
  IdentitySecretCarryOutcome,
} from "./services/identity-secret-carry.service.ts";
export type { IdentityHeadsReader } from "./repositories/identity-heads.repository.ts";
export type { IdentifierReservationHolder } from "./repositories/identity-reservations.repository.ts";
export type { IdentityLedger } from "./rules/identity-ledger.rules.ts";
export type { IdentityUserGate } from "./rules/identity-user-gate.rules.ts";
export type { IdentityUsersRepository } from "./repositories/identity-users.repository.ts";
export type { IdentityVerificationRecord } from "./repositories/identity-verification.repository.ts";
export type { MfaEnrollmentRepository } from "./repositories/mfa-enrollment.repository.ts";
export { SsoBreakGlassWarningChannel } from "./channels/sso-break-glass-warning.channel.ts";
export type { SsoConnectionHistoryEntry } from "./repositories/sso-connection-history.repository.ts";
export type { SsoBreakGlassServiceDeps } from "./services/sso-break-glass.service.ts";
export type {
  IdentitySignInAccountsRepository,
  LegacySignInAccount,
} from "./repositories/identity-signin-accounts.repository.ts";
export type { SignInAccountLookupServiceDeps } from "./services/signin-account-lookup.service.ts";
export type {
  SignInAccountLookup,
  SignInBreakGlassLimiter,
  SignInDomainRouting,
  SignInRouteRequest,
  SignInRouterDeps,
  SignInRoutingRecord,
  SignInRoutingRecorder,
} from "./services/signin-router.service.ts";
export type {
  IdentityAdoptionWrites,
  IdentityCeremonyWrites,
  IdentityLinkProposalWrites,
  IdentityVerificationWrites,
} from "./rules/identity-writes.rules.ts";
export { IdentityJitDisabledError, IdentityLinkProposedError } from "@langwatch/identity-contract";
export type {
  CallbackAssertion,
  CallbackAuditRecord,
  CallbackLinkOutcome,
  CallbackUserMatch,
  SignInCallbackAudit,
  SignInCallbackDirectory,
  SignInCallbackLinkingDeps,
} from "./services/signin-callback-linking.service.ts";
export type { JoinRequestGuardsDeps } from "./services/join-request-guards.service.ts";
export type { JoinRequestAudienceRepository } from "./repositories/join-request-audience.repository.ts";
export type { JoinRequestMail } from "./services/join-request-notification.service.ts";
export type { SsoDomainProofMail } from "./channels/sso-domain-proof-mail.channel.ts";
export type { JoinRequestLedger } from "./rules/join-request-ledger.rules.ts";
export type {
  SsoConnectionGrandfatherDeps,
  SsoConnectionGrandfatherOutcome,
} from "./services/sso-connection-grandfather.service.ts";
export type { SsoConnectionGuardsDeps } from "./services/sso-connection-guard-checks.service.ts";
export type { SsoConnectionLedger } from "./rules/sso-connection-ledger.rules.ts";
export type {
  MintedEmailVerification,
  VerificationCeremonyDeps,
} from "./services/verification-ceremony.service.ts";

// --------------------------------------------------------------------------- The composition half
// the platform application used to own Every module below was `platform/app/src/server/app-
// layer/identity/`: the Postgres repositories the guards and the fold read and write through, the
// two ledger writers, the join-request orchestration around the event-sourced lifecycle, and the
// instance's sign-in method policy.
export type {
  IdentityEventing,
  IdentityPipelineCommand,
} from "./eventing/identity-command-senders.store.ts";
export {
  IDENTITY_CONVERGENCE_POLL_MS,
  IDENTITY_CONVERGENCE_TIMEOUT_MS,
  IdentityLedgerStore,
  type IdentityLedgerWriterDeps,
  type IdentityStagedSender,
} from "./eventing/identity-ledger.store.ts";
export {
  JOIN_REQUEST_CONVERGENCE_POLL_MS,
  JOIN_REQUEST_CONVERGENCE_TIMEOUT_MS,
  JoinRequestLedgerStore,
  type JoinRequestLedgerWriterDeps,
  type JoinRequestStagedSender,
} from "./eventing/join-request-ledger.store.ts";
export type { JoinRequestNotificationMail } from "./channels/join-request-notification-mail.channel.ts";
export type { SsoConnectionBackofficePage } from "./repositories/sso-connection-backoffice.repository.ts";
export type { PrismaSsoConnectionBackofficeDatabase } from "./repositories/prisma/prisma.sso-connection-backoffice.repository.ts";
export type { SsoConnectionRoutingRepository } from "./repositories/sso-connection-routing.repository.ts";
export type { PrismaSsoConnectionRoutingDatabase } from "./repositories/prisma/prisma.sso-connection-routing.repository.ts";
export type { SsoMethodConfiguration, SsoMethodDial } from "./rules/sso-method-dial.rules.ts";
export type {
  JoinMembership,
  JoinRequestNotifier,
  JoinRequestsServiceDeps,
  JoinSetting,
} from "./rules/join-requests-contract.rules.ts";
export type { PrismaIdentityHeadsDatabase } from "./repositories/prisma/prisma.identity-heads.repository.ts";

// The identity graph's remaining application half: the address-lock
// reaper, the write-gate latch, the SCIM sync ledger and projection,
// the operator back office, the teardown dispatcher, the three system
// migrations and the Prisma repositories behind them. All were
// `platform/app/src/server/app-layer/identity/`.
export type {
  IdentityNewbornReconciliationDeps,
  IdentityNewbornSweepSummary,
} from "./services/identity-newborn-reconciliation.service.ts";
export type { IdentityWriteGateState } from "./services/identity-write-gate.service.ts";

// better-auth's `database:` entry and its two account ceremonies (ADR-116 §1,
// §5). Exported because the process that mounts better-auth composes them; a
// deployment that reaches neither runs the stock storage engine and no
// ceremonies, which is what it did before they were written.
export type { IdentityStorageAdapterDeps } from "./services/better-auth-identity-storage.service.ts";
export type { PrismaIdentityUsersDatabase } from "./repositories/prisma/prisma.identity-users.repository.ts";
export type {
  BackofficeSsoConnection,
  BackofficeSsoConnectionList,
  OperatorActor,
} from "./services/sso-connection-backoffice.service.ts";
export type { PerSubjectCachedFlag } from "./services/per-subject-cached-gate.service.ts";
export type { ConnectionDirectoryRevocation } from "./services/sso-connection-teardown.service.ts";
export type { IdentityRepositories } from "./repositories/identity.repositories.ts";
export {
  composeIdentityGuards,
  composeIdentityPipeline,
  type IdentityGuardsComposition,
} from "./eventing/user-identity.pipeline.ts";
export {
  composeJoinRequestNotifications,
  composeJoinRequestPipeline,
} from "./eventing/join-request.pipeline.ts";
export {
  composeSsoConnectionGraph,
  type SsoConnectionGraph,
} from "./eventing/sso-connection.pipeline.ts";
